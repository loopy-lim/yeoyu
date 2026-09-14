package dev.browser

import java.math.BigDecimal
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneOffset
import java.time.temporal.IsoFields
import java.util.Locale

internal data class WebChoice(val id: String, val label: String, val disabled: Boolean = false,
    val selected: Boolean = false, val children: List<WebChoice>? = null, val separator: Boolean = false)
internal data class ChoiceRow(val id: String, val label: String, val enabled: Boolean, val depth: Int, val heading: Boolean)

/** Gecko regenerates option IDs after DOM mutations, so every replacement starts from its own selection. */
internal class ChoiceSelection(choices: List<WebChoice>) {
    var rows: List<ChoiceRow> = emptyList(); private set
    private val selected = linkedSetOf<String>()
    init { replace(choices) }
    fun replace(choices: List<WebChoice>) {
        selected.clear()
        val flattened = mutableListOf<ChoiceRow>()
        fun append(items: List<WebChoice>, depth: Int, disabled: Boolean) {
            items.forEach { item ->
                val blocked = disabled || item.disabled
                val heading = item.children != null || item.separator
                flattened.add(ChoiceRow(item.id, item.label, !blocked && !heading, depth, heading))
                if (!heading && item.selected) selected.add(item.id)
                item.children?.let { append(it, depth + 1, blocked) }
            }
        }
        append(choices, 0, false)
        rows = flattened
    }
    fun toggle(id: String): Boolean {
        if (rows.none { it.id == id && it.enabled }) return false
        if (!selected.remove(id)) selected.add(id)
        return true
    }
    fun isSelected(id: String): Boolean = id in selected
    // Keep disabled preselected options; disabling an option does not deselect it in HTML.
    fun selectedIds(): List<String> = rows.filter { it.id in selected }.map { it.id }
}

internal enum class WebDateKind { DATE, MONTH, WEEK, TIME, DATETIME_LOCAL }

/** All arithmetic uses local calendar values; the user's time zone never shifts the submitted value. */
internal class DateTimeConstraints(val kind: WebDateKind, val min: String? = null,
    val max: String? = null, val step: String? = null) {
    fun error(value: String): String? {
        if (value.isEmpty()) return null // Clear is distinct from Cancel; required is validated by the page.
        val number = parse(value) ?: return "Enter a valid ${kind.name.lowercase(Locale.ROOT).replace('_', ' ')} value"
        val lower = min?.let(::parse)
        val upper = max?.let(::parse)
        val outside = if (kind == WebDateKind.TIME && lower != null && upper != null && lower > upper)
            number < lower && number > upper
        else (lower != null && number < lower) || (upper != null && number > upper)
        if (outside) return "Choose a value within the page's range"
        val validStep = step?.takeIf { it.length <= 128 }
            ?.takeIf { it.toDoubleOrNull()?.let { value -> value.isFinite() && value > 0 } == true }
            ?.toBigDecimalOrNull()
        val increment = if (step.equals("any", ignoreCase = true)) null
            else validStep
                ?: if (kind == WebDateKind.TIME || kind == WebDateKind.DATETIME_LOCAL) BigDecimal(60) else BigDecimal.ONE
        // GV155 exposes current value, not the HTML value attribute used as step base.
        // A valid min is the only exact base available; unknown-base validation remains with Gecko.
        if (lower != null && increment != null && (number - lower).remainder(increment).signum() != 0)
            return "Choose a value in steps of ${step?.takeUnless { it.isBlank() } ?: increment.toPlainString()} from $min"
        return null
    }

    private fun parse(value: String): BigDecimal? = try {
        when (kind) {
            WebDateKind.DATE -> date(value)?.toEpochDay()?.toBigDecimal()
            WebDateKind.MONTH -> {
                val match = Regex("([0-9]{4,9})-([0-9]{2})").matchEntire(value)
                match?.let {
                    val year = it.groupValues[1].toInt(); val month = it.groupValues[2].toInt()
                    LocalDate.of(year, month, 1).takeIf { year > 0 }
                        ?.let { ((year.toLong() - 1970) * 12 + month - 1).toBigDecimal() }
                }
            }
            WebDateKind.WEEK -> {
                val match = Regex("([0-9]{4,9})-W([0-9]{2})").matchEntire(value)
                match?.let {
                    val year = it.groupValues[1].toInt(); val week = it.groupValues[2].toInt()
                    if (year <= 0 || week !in 1..53) null else {
                        val monday = LocalDate.of(year, 1, 4).with(IsoFields.WEEK_OF_WEEK_BASED_YEAR, week.toLong())
                            .with(java.time.temporal.ChronoField.DAY_OF_WEEK, 1)
                        if (monday.get(IsoFields.WEEK_BASED_YEAR) != year) null
                        else ((monday.toEpochDay() + 3) / 7).toBigDecimal()
                    }
                }
            }
            WebDateKind.TIME -> time(value)?.let { BigDecimal.valueOf(it.toNanoOfDay(), 9) }
            WebDateKind.DATETIME_LOCAL -> {
                val parts = value.split('T', ' ')
                if (parts.size != 2) null else {
                    val day = date(parts[0]); val clock = time(parts[1])
                    if (day == null || clock == null) null else
                        BigDecimal.valueOf(LocalDateTime.of(day, clock).toEpochSecond(ZoneOffset.UTC)) + BigDecimal.valueOf(clock.nano.toLong(), 9)
                }
            }
        }
    } catch (_: RuntimeException) { null }

    private fun date(value: String): LocalDate? {
        val match = Regex("([0-9]{4,9})-([0-9]{2})-([0-9]{2})").matchEntire(value) ?: return null
        val year = match.groupValues[1].toInt()
        return if (year > 0) LocalDate.of(year, match.groupValues[2].toInt(), match.groupValues[3].toInt()) else null
    }
    private fun time(value: String): LocalTime? =
        if (Regex("[0-9]{2}:[0-9]{2}(:[0-9]{2}(\\.[0-9]{1,3})?)?").matches(value)) LocalTime.parse(value) else null
}

internal fun normalizePromptColor(value: String): String? =
    value.takeIf { Regex("#[0-9a-fA-F]{6}").matches(it) }?.lowercase(Locale.ROOT)

/** Main-thread prompt state: take retires the request before any reentrant Gecko callback. */
internal class PromptLifecycle<T: Any>(initial: T) {
    var current: T = initial; private set
    var isComplete = false; private set
    fun replace(value: T): Boolean {
        if (isComplete) return false
        current = value
        return true
    }
    fun take(): T? {
        if (isComplete) return null
        isComplete = true
        return current
    }
}
