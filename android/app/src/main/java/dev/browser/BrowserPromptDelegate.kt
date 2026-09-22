package dev.browser

import android.app.Activity
import android.app.AlertDialog
import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.graphics.Color
import android.text.InputType
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckedTextView
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView
import com.facebook.react.bridge.UiThreadUtil
import com.workspacebrowser.R
import java.time.LocalDate
import java.time.LocalTime
import java.util.Locale
import org.mozilla.geckoview.AllowOrDeny
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSession.PromptDelegate.*

/** Every response belongs to one live prompt; DOM updates replace its value, never its result. */
class BrowserPromptDelegate(private val session: GeckoSession, private val activityProvider: () -> Activity?,
    private val isCurrent: () -> Boolean) : GeckoSession.PromptDelegate {
    private fun str(activity: Activity, id: Int, vararg args: Any) = BrowserAppStrings.get(activity, id, *args)
    private val pending = mutableMapOf<Any, () -> Unit>()
    fun hasPending(): Boolean = pending.isNotEmpty() || FilePromptCoordinator.hasPending(session)
    fun cancelPending() {
        pending.values.toList().forEach { it() }
        FilePromptCoordinator.cancelPending(session)
    }
    fun dismissAll() = cancelPending()

    private class DialogActions<T : BasePrompt>(val finish: ((T) -> PromptResponse) -> Unit) {
        var onShow: (AlertDialog) -> Unit = {}
        val auxiliary = mutableListOf<android.app.Dialog>()
    }

    private fun <T : BasePrompt> show(initial: T,
        configure: (T, Activity, AlertDialog.Builder, DialogActions<T>) -> Unit): GeckoResult<PromptResponse> {
        val result = GeckoResult<PromptResponse>()
        val state = PromptLifecycle(initial)
        var dialog: AlertDialog? = null
        var actions: DialogActions<T>? = null
        fun hide() {
            actions?.auxiliary?.toList()?.forEach { it.dismiss() }
            dialog?.setOnDismissListener(null)
            dialog?.dismiss()
            dialog = null
        }
        fun finish(response: (T) -> PromptResponse) {
            val prompt = state.take() ?: return
            pending.remove(state)
            try { result.complete(if (isCurrent()) response(prompt) else prompt.dismiss()) }
            catch (failure: Exception) { result.completeExceptionally(failure) }
            hide()
        }
        val cancel = { finish { it.dismiss() } }
        pending[state] = cancel
        fun render() {
            if (state.isComplete) return
            val activity = activityProvider()
            if (!isCurrent() || activity == null || activity.isFinishing || activity.isDestroyed) { cancel(); return }
            hide()
            try {
                val action = DialogActions<T>(::finish)
                actions = action
                val builder = AlertDialog.Builder(activity).setTitle(state.current.title).setOnCancelListener { cancel() }
                configure(state.current, activity, builder, action)
                dialog = builder.create().also {
                    it.setOnDismissListener { cancel() }
                    it.show()
                    action.onShow(it)
                }
            } catch (_: Exception) { cancel() }
        }
        initial.setDelegate(object : PromptInstanceDelegate {
            override fun onPromptDismiss(prompt: BasePrompt) = cancel()
            override fun onPromptUpdate(prompt: BasePrompt) {
                if (!initial.javaClass.isInstance(prompt)) { cancel(); return }
                @Suppress("UNCHECKED_CAST") val updated = prompt as T
                if (state.replace(updated)) render()
            }
        })
        UiThreadUtil.runOnUiThread { render() }
        return result
    }

    override fun onAlertPrompt(session: GeckoSession, prompt: AlertPrompt): GeckoResult<PromptResponse> =
        show(prompt) { current, activity, builder, action -> builder.setMessage(current.message)
            .setPositiveButton(str(activity, R.string.browser_ok)) { _, _ -> action.finish { it.dismiss() } } }
    override fun onButtonPrompt(session: GeckoSession, prompt: ButtonPrompt): GeckoResult<PromptResponse> =
        show(prompt) { current, activity, builder, action -> builder.setMessage(current.message)
            .setPositiveButton(str(activity, R.string.browser_ok)) { _, _ -> action.finish { it.confirm(ButtonPrompt.Type.POSITIVE) } }
            .setNegativeButton(str(activity, R.string.browser_cancel)) { _, _ -> action.finish { it.confirm(ButtonPrompt.Type.NEGATIVE) } } }
    override fun onTextPrompt(session: GeckoSession, prompt: TextPrompt): GeckoResult<PromptResponse> =
        show(prompt) { current, activity, builder, action ->
            val input = EditText(activity).apply { setText(current.defaultValue); setSingleLine() }
            builder.setMessage(current.message).setView(input)
                .setPositiveButton(str(activity, R.string.browser_ok)) { _, _ -> action.finish { it.confirm(input.text.toString()) } }
                .setNegativeButton(str(activity, R.string.browser_cancel)) { _, _ -> action.finish { it.dismiss() } }
        }
    override fun onBeforeUnloadPrompt(session: GeckoSession, prompt: BeforeUnloadPrompt): GeckoResult<PromptResponse> =
        show(prompt) { _, activity, builder, action -> builder.setMessage(str(activity, R.string.browser_leave_warning))
            .setPositiveButton(str(activity, R.string.browser_leave)) { _, _ -> action.finish { it.confirm(AllowOrDeny.ALLOW) } }
            .setNegativeButton(str(activity, R.string.browser_stay)) { _, _ -> action.finish { it.confirm(AllowOrDeny.DENY) } } }

    override fun onAuthPrompt(session: GeckoSession, prompt: AuthPrompt): GeckoResult<PromptResponse> =
        show(prompt) { current, activity, builder, action ->
            val options = current.authOptions
            val onlyPassword = options.flags and AuthPrompt.AuthOptions.Flags.ONLY_PASSWORD != 0
            val username = EditText(activity).apply {
                hint = str(activity, R.string.browser_username); setSingleLine()
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
                setText(options.username)
            }
            val password = EditText(activity).apply {
                hint = str(activity, R.string.browser_password); setSingleLine()
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
                transformationMethod = android.text.method.PasswordTransformationMethod.getInstance()
                setText(options.password)
            }
            val form = form(activity).apply { if (!onlyPassword) addView(username); addView(password) }
            builder.setTitle(str(activity, R.string.browser_sign_in)).setMessage(listOfNotNull(options.uri, current.message).joinToString("\n")).setView(form)
                .setPositiveButton(str(activity, R.string.browser_sign_in)) { _, _ -> action.finish {
                    if (onlyPassword) it.confirm(password.text.toString()) else it.confirm(username.text.toString(), password.text.toString())
                } }.setNegativeButton(str(activity, R.string.browser_cancel)) { _, _ -> action.finish { it.dismiss() } }
        }

    override fun onChoicePrompt(session: GeckoSession, prompt: ChoicePrompt): GeckoResult<PromptResponse> =
        show(prompt) { current, activity, builder, action ->
            fun choices(items: Array<ChoicePrompt.Choice>): List<WebChoice> = items.map {
                WebChoice(it.id, it.label, it.disabled, it.selected, it.items?.let(::choices), it.separator)
            }
            val selection = ChoiceSelection(choices(current.choices))
            val multiple = current.type == ChoicePrompt.Type.MULTIPLE
            val list = ListView(activity)
            val adapter = object : ArrayAdapter<ChoiceRow>(activity, android.R.layout.simple_list_item_multiple_choice, selection.rows) {
                override fun areAllItemsEnabled() = false
                override fun isEnabled(position: Int) = selection.rows[position].enabled
                override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                    val row = selection.rows[position]
                    val view = (convertView as? CheckedTextView) ?: CheckedTextView(activity).apply {
                        minHeight = dp(activity, 48); gravity = android.view.Gravity.CENTER_VERTICAL; textSize = 18f
                    }
                    view.text = row.label.ifEmpty { if (row.heading) "────────" else str(activity, R.string.browser_empty_option) }
                    view.setPadding(dp(activity, 20 + row.depth * 16), dp(activity, 8), dp(activity, 20), dp(activity, 8))
                    view.isEnabled = row.enabled
                    view.alpha = if (row.enabled || row.heading) 1f else 0.5f
                    view.setTypeface(null, if (row.heading) android.graphics.Typeface.BOLD else android.graphics.Typeface.NORMAL)
                    if (row.heading) view.checkMarkDrawable = null else {
                        val theme = activity.obtainStyledAttributes(intArrayOf(if (multiple)
                            android.R.attr.listChoiceIndicatorMultiple else android.R.attr.listChoiceIndicatorSingle))
                        try { view.checkMarkDrawable = theme.getDrawable(0) } finally { theme.recycle() }
                    }
                    view.isChecked = selection.isSelected(row.id)
                    return view
                }
            }
            list.adapter = adapter
            list.setOnItemClickListener { _, _, position, _ ->
                val row = selection.rows[position]
                if (row.enabled) {
                    if (multiple) { selection.toggle(row.id); adapter.notifyDataSetChanged() }
                    else action.finish { it.confirm(row.id) }
                }
            }
            val wrapper = android.widget.FrameLayout(activity).apply {
                addView(list, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(activity, (selection.rows.size * 52).coerceIn(52, 400))))
            }
            builder.setTitle(current.title ?: str(activity, R.string.browser_choose_option)).setView(wrapper)
                .setNegativeButton(str(activity, R.string.browser_cancel)) { _, _ -> action.finish { it.dismiss() } }
            if (multiple) builder.setPositiveButton(str(activity, R.string.browser_ok)) { _, _ -> action.finish { it.confirm(selection.selectedIds().toTypedArray()) } }
        }

    override fun onDateTimePrompt(session: GeckoSession, prompt: DateTimePrompt): GeckoResult<PromptResponse> =
        show(prompt) { current, activity, builder, action ->
            val kind = when (current.type) {
                DateTimePrompt.Type.DATE -> WebDateKind.DATE
                DateTimePrompt.Type.MONTH -> WebDateKind.MONTH
                DateTimePrompt.Type.WEEK -> WebDateKind.WEEK
                DateTimePrompt.Type.TIME -> WebDateKind.TIME
                else -> WebDateKind.DATETIME_LOCAL
            }
            val example = when (kind) {
                WebDateKind.DATE -> "YYYY-MM-DD"; WebDateKind.MONTH -> "YYYY-MM"; WebDateKind.WEEK -> "YYYY-Www"
                WebDateKind.TIME -> "HH:mm[:ss[.SSS]]"; WebDateKind.DATETIME_LOCAL -> "YYYY-MM-DDTHH:mm[:ss[.SSS]]"
            }
            val constraints = DateTimeConstraints(kind, current.minValue, current.maxValue, current.stepValue)
            val input = EditText(activity).apply {
                setSingleLine(); hint = example; contentDescription = str(activity, R.string.browser_selected_value, example)
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
                setText(current.defaultValue.orEmpty())
            }
            val form = form(activity).apply {
                addView(input)
                addView(TextView(activity).apply {
                    text = listOfNotNull(current.minValue?.takeIf { it.isNotBlank() }?.let { str(activity, R.string.browser_from, it) },
                        current.maxValue?.takeIf { it.isNotBlank() }?.let { str(activity, R.string.browser_through, it) },
                        current.stepValue?.takeIf { it.isNotBlank() }?.let { str(activity, R.string.browser_step, it) }).joinToString(" · ")
                })
            }
            if (kind == WebDateKind.DATE || kind == WebDateKind.DATETIME_LOCAL) form.addView(Button(activity).apply {
                text = str(activity, R.string.browser_choose_date)
                setOnClickListener {
                    val date = runCatching { LocalDate.parse(input.text.toString().substringBefore('T')) }.getOrNull() ?: LocalDate.now()
                    val picker = DatePickerDialog(activity, { _, year, month, day ->
                        val selected = String.format(Locale.ROOT, "%04d-%02d-%02d", year, month + 1, day)
                        val oldTime = input.text.toString().substringAfter('T', "00:00")
                        input.setText(if (kind == WebDateKind.DATE) selected else "${selected}T$oldTime")
                    }, date.year.coerceIn(1, 9999), date.monthValue - 1, date.dayOfMonth)
                    action.auxiliary.add(picker); picker.show()
                }
            })
            if (kind == WebDateKind.TIME || kind == WebDateKind.DATETIME_LOCAL) form.addView(Button(activity).apply {
                text = str(activity, R.string.browser_choose_time)
                setOnClickListener {
                    val old = input.text.toString()
                    val time = runCatching { LocalTime.parse(old.substringAfter('T', old)) }.getOrNull() ?: LocalTime.now()
                    val picker = TimePickerDialog(activity, { _, hour, minute ->
                        val selected = String.format(Locale.ROOT, "%02d:%02d", hour, minute)
                        val precision = old.substringAfter('T', old).let { if (it.length > 5) it.substring(5) else "" }
                        input.setText(if (kind == WebDateKind.TIME) "$selected$precision"
                            else "${old.substringBefore('T').takeIf { it.contains('-') } ?: LocalDate.now()}T$selected$precision")
                    }, time.hour, time.minute, true)
                    action.auxiliary.add(picker); picker.show()
                }
            })
            val kindLabel = str(activity, when (kind) {
                WebDateKind.DATE -> R.string.browser_kind_date
                WebDateKind.MONTH -> R.string.browser_kind_month
                WebDateKind.WEEK -> R.string.browser_kind_week
                WebDateKind.TIME -> R.string.browser_kind_time
                WebDateKind.DATETIME_LOCAL -> R.string.browser_kind_datetime
            })
            builder.setTitle(current.title ?: str(activity, R.string.browser_choose_kind, kindLabel))
                .setView(ScrollView(activity).apply { addView(form) })
                .setPositiveButton(str(activity, R.string.browser_ok), null)
                .setNeutralButton(str(activity, R.string.browser_clear)) { _, _ -> action.finish { it.confirm("") } }
                .setNegativeButton(str(activity, R.string.browser_cancel)) { _, _ -> action.finish { it.dismiss() } }
            action.onShow = { dialog -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val value = input.text.toString()
                val error = constraints.error(value)
                if (error != null) { input.error = error; input.requestFocus() }
                else action.finish { it.confirm(value) }
            } }
        }

    override fun onColorPrompt(session: GeckoSession, prompt: ColorPrompt): GeckoResult<PromptResponse> =
        show(prompt) { current, activity, builder, action ->
            val initial = normalizePromptColor(current.defaultValue.orEmpty()) ?: "#000000"
            val input = EditText(activity).apply { setSingleLine(); hint = "#RRGGBB"; setText(initial); contentDescription = str(activity, R.string.browser_hex_color) }
            val preview = View(activity).apply { setBackgroundColor(Color.parseColor(initial)) }
            val form = form(activity).apply { addView(input); addView(preview, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(activity, 40))) }
            val channels = intArrayOf(Color.red(Color.parseColor(initial)), Color.green(Color.parseColor(initial)), Color.blue(Color.parseColor(initial)))
            val sliders = mutableListOf<SeekBar>()
            listOf(str(activity, R.string.browser_red), str(activity, R.string.browser_green), str(activity, R.string.browser_blue)).forEachIndexed { index, label ->
                form.addView(TextView(activity).apply { text = label })
                form.addView(SeekBar(activity).apply {
                    sliders.add(this)
                    max = 255; progress = channels[index]; contentDescription = label
                    setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                        override fun onStartTrackingTouch(bar: SeekBar) {}
                        override fun onStopTrackingTouch(bar: SeekBar) {}
                        override fun onProgressChanged(bar: SeekBar, progress: Int, fromUser: Boolean) {
                            if (!fromUser) return
                            channels[index] = progress
                            val value = String.format(Locale.ROOT, "#%02x%02x%02x", channels[0], channels[1], channels[2])
                            input.setText(value); preview.setBackgroundColor(Color.parseColor(value))
                        }
                    })
                })
            }
            input.addTextChangedListener(object : android.text.TextWatcher {
                override fun beforeTextChanged(text: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(text: CharSequence?, start: Int, before: Int, count: Int) {
                    val color = normalizePromptColor(text?.toString().orEmpty()) ?: return
                    val parsed = Color.parseColor(color)
                    channels[0] = Color.red(parsed); channels[1] = Color.green(parsed); channels[2] = Color.blue(parsed)
                    sliders.forEachIndexed { index, slider -> slider.progress = channels[index] }
                    preview.setBackgroundColor(parsed)
                }
                override fun afterTextChanged(text: android.text.Editable?) {}
            })
            current.predefinedValues.orEmpty().mapNotNull(::normalizePromptColor).distinct().take(24).forEach { color ->
                form.addView(Button(activity).apply { text = color; setOnClickListener { input.setText(color); preview.setBackgroundColor(Color.parseColor(color)) } })
            }
            builder.setTitle(current.title ?: str(activity, R.string.browser_choose_color)).setView(ScrollView(activity).apply { addView(form) })
                .setPositiveButton(str(activity, R.string.browser_ok), null).setNegativeButton(str(activity, R.string.browser_cancel)) { _, _ -> action.finish { it.dismiss() } }
            action.onShow = { dialog -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val value = normalizePromptColor(input.text.toString())
                if (value == null) { input.error = str(activity, R.string.browser_hex_error); input.requestFocus() }
                else action.finish { it.confirm(value) }
            } }
        }

    override fun onFilePrompt(session: GeckoSession, prompt: FilePrompt): GeckoResult<PromptResponse> {
        val activity = activityProvider()
        if (!isCurrent() || activity == null || activity.isFinishing || activity.isDestroyed) return GeckoResult.fromValue(prompt.dismiss())
        return FilePromptCoordinator.start(activity, session, prompt, isCurrent)
    }
    private fun dp(activity: Activity, value: Int): Int = (value * activity.resources.displayMetrics.density).toInt()
    private fun form(activity: Activity) = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL; setPadding(dp(activity, 20), dp(activity, 8), dp(activity, 20), dp(activity, 8))
    }
}
