package dev.browser

import android.content.Context
import android.util.Base64
import java.io.File
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties

/** Encrypted-at-rest storage for Firefox Sync credentials. The cleartext JSON
 *  (refresh token, kSync, kid, tokenserver info) never touches prefs or disk:
 *  it is sealed with an AES-256-GCM key that lives in AndroidKeyStore and
 *  cannot be exported. A tampered or unreadable blob is wiped (worst case the
 *  user re-connects; Phase 1 is receive-only so nothing local is lost). */
object SyncSecretsStore {
    private const val PREFS = "browser-sync-secrets"
    private const val BLOB_KEY = "secrets"
    private const val ALIAS = "yeoyu-sync-secrets-master"
    private const val GCM_TAG_BITS = 128
    private const val IV_LENGTH = 12

    fun read(context: Context): String? {
        val app = context.applicationContext
        val blob = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(BLOB_KEY, null)
            ?: return null
        // v1:<base64 iv>:<base64 ciphertext+tag>
        val parts = blob.split(":")
        if (parts.size != 3 || parts[0] != "v1") return wipe(app, "format")
        return try {
            val iv = Base64.decode(parts[1], Base64.NO_WRAP)
            val sealed = Base64.decode(parts[2], Base64.NO_WRAP)
            if (iv.size != IV_LENGTH) throw IllegalArgumentException("iv length")
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, secretKey(app), GCMParameterSpec(GCM_TAG_BITS, iv))
            String(cipher.doFinal(sealed), Charsets.UTF_8)
        } catch (_: Exception) {
            wipe(app, "decrypt")
        }
    }

    fun save(context: Context, json: String) {
        val app = context.applicationContext
        val iv = ByteArray(IV_LENGTH).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey(app), GCMParameterSpec(GCM_TAG_BITS, iv))
        val sealed = cipher.doFinal(json.toByteArray(Charsets.UTF_8))
        val blob = "v1:" +
            Base64.encodeToString(iv, Base64.NO_WRAP) + ":" +
            Base64.encodeToString(sealed, Base64.NO_WRAP)
        // commit(): credentials must be durable before the promise resolves —
        // an apply() lost to process death would silently disconnect sync.
        if (!app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(BLOB_KEY, blob).commit())
            throw IllegalStateException("sync secrets write failed")
    }

    fun clear(context: Context) {
        val app = context.applicationContext
        // commit(), like save(): a disconnect lost to process death would
        // resurrect the connection after reboot.
        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(BLOB_KEY).commit()
    }

    /** Decryption failure includes keystore key loss (e.g. backup restore to a
     *  new device): the alias is deleted so the next save provisions a fresh
     *  key instead of wedging every future write. */
    private fun wipe(app: Context, reason: String): String? {
        try {
            val keyStore = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            if (keyStore.containsAlias(ALIAS)) keyStore.deleteEntry(ALIAS)
        } catch (_: Exception) {
        }
        clear(app)
        return null
    }

    private fun secretKey(app: Context): SecretKey {
        val keyStore = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getEntry(ALIAS, null) as? java.security.KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                // save() supplies a fresh SecureRandom IV per write; without
                // this flag the AndroidKeyStore provider rejects caller IVs
                // (InvalidAlgorithmParameterException) and every save fails.
                .setRandomizedEncryptionRequired(false)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }
}

/** Plaintext JSON of the last fetched bookmark tree. Not secret (bookmark
 *  titles/URLs are already in the profile), but large — hence a file with
 *  atomic replace rather than prefs. */
object SyncTreeStore {
    private const val FILE_NAME = "sync-tree-v1.json"
    private const val MAX_BYTES = 16L * 1024 * 1024

    fun read(context: Context): String? {
        val file = file(context)
        if (!file.isFile) return null
        val length = file.length()
        if (length > MAX_BYTES) throw IllegalStateException("sync tree file too large")
        return file.readText(Charsets.UTF_8)
    }

    fun save(context: Context, json: String) {
        val app = context.applicationContext
        val file = file(app)
        val temp = File(file.parentFile, "$FILE_NAME.tmp")
        if (json.toByteArray(Charsets.UTF_8).size > MAX_BYTES)
            throw IllegalStateException("sync tree too large to save")
        try {
            temp.writeText(json, Charsets.UTF_8)
            if (!temp.renameTo(file)) {
                // Cross-filesystem rename can fail; fall back to copy+delete.
                temp.copyTo(file, overwrite = true)
                temp.delete()
            }
        } finally {
            if (temp.exists()) temp.delete()
        }
    }

    fun clear(context: Context) {
        val file = file(context)
        if (file.exists()) file.delete()
    }

    private fun file(context: Context): File = File(context.applicationContext.filesDir, FILE_NAME)
}

/** Plaintext JSON of the outbound sync bookkeeping (local id ↔ guid mappings,
 *  dirty log, pending tombstones, last-received cleartexts). Not secret — the
 *  bookmark contents it mirrors already live in the tree channel/profile —
 *  but large, hence the same file + atomic-replace contract as SyncTreeStore.
 *  Cleared together with the other channels on disconnect (V-9). */
object OutboundStore {
    private const val FILE_NAME = "sync-outbound-v1.json"
    private const val MAX_BYTES = 16L * 1024 * 1024

    fun read(context: Context): String? {
        val file = file(context)
        if (!file.isFile) return null
        val length = file.length()
        if (length > MAX_BYTES) throw IllegalStateException("sync outbound file too large")
        return file.readText(Charsets.UTF_8)
    }

    fun save(context: Context, json: String) {
        val app = context.applicationContext
        val file = file(app)
        val temp = File(file.parentFile, "$FILE_NAME.tmp")
        if (json.toByteArray(Charsets.UTF_8).size > MAX_BYTES)
            throw IllegalStateException("sync outbound state too large to save")
        try {
            temp.writeText(json, Charsets.UTF_8)
            if (!temp.renameTo(file)) {
                // Cross-filesystem rename can fail; fall back to copy+delete.
                temp.copyTo(file, overwrite = true)
                temp.delete()
            }
        } finally {
            if (temp.exists()) temp.delete()
        }
    }

    fun clear(context: Context) {
        val file = file(context)
        if (file.exists()) file.delete()
    }

    private fun file(context: Context): File = File(context.applicationContext.filesDir, FILE_NAME)
}
