package dev.browser

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Handler
import org.mozilla.geckoview.MediaSession

/** Shared by Home and external PiP. Audio outlives their display transfers until a real GAIN. */
internal class ExternalPipAudio(context: Context, private val main: Handler) {
    private val manager = context.getSystemService(AudioManager::class.java)
    private val policy = PictureInPictureAudioFocusPolicy()
    private var source: ExternalPipSource? = null
    private var documentGeneration: Long? = null
    private var media: MediaSession? = null
    private var request: AudioFocusRequest? = null
    private var held = false
    private var intent = PictureInPicturePlaybackIntent()

    private fun entry(): GeckoSessionRegistry.Entry? {
        val owner = source ?: return null
        return GeckoSessionRegistry.entry(owner.tabId)?.takeIf {
            it.session === owner.session && it.sessionVersion == owner.sessionVersion && it.session.isOpen &&
                it.documentGeneration == documentGeneration
        }
    }
    fun bind(owner: ExternalPipSource, activeMedia: MediaSession) {
        val generation = GeckoSessionRegistry.entry(owner.tabId)?.takeIf {
            it.session === owner.session && it.sessionVersion == owner.sessionVersion && it.session.isOpen
        }?.documentGeneration ?: return
        if (!samePipAudioSession(source, owner) || generation != documentGeneration) {
            clear()
            // A focus request retains session identity, never the former Activity's View.
            source = owner.copy(view = owner.session)
            documentGeneration = generation
            media = activeMedia
            intent = PictureInPicturePlaybackIntent()
        }
    }
    fun changed(id: String) {
        if (source?.tabId != id) return
        val current = entry() ?: run { clear(); return }
        intent.observe(current.playing)
        if (request == null && intent.canAcquire(current.playing)) acquire()
    }
    fun pause() {
        val current = entry() ?: return
        intent.requestPause(current.playing)
        (current.media ?: media)?.pause()
        abandon()
    }
    fun play() {
        intent.requestPlay()
        if (acquire(explicit = true)) (entry()?.media ?: media)?.play()
    }
    fun acquire(explicit: Boolean = false): Boolean {
        val owner = source ?: return false
        val current = entry() ?: run { clear(); return false }
        if (explicit) intent.requestPlay()
        if (request != null) return held
        if (!intent.canAcquire(current.playing, explicit)) return false
        val target = PictureInPictureTarget(owner.tabId, owner.sessionVersion)
        val token = policy.begin(target, owner.session)
        val next = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE).build())
            .setOnAudioFocusChangeListener({ change ->
                val active = entry() ?: return@setOnAudioFocusChangeListener
                if (!policy.owns(token, source?.let { PictureInPictureTarget(it.tabId, it.sessionVersion) }, active.session))
                    return@setOnAudioFocusChangeListener
                val sessionMedia = active.media ?: media ?: return@setOnAudioFocusChangeListener
                when (change) {
                    AudioManager.AUDIOFOCUS_GAIN -> {
                        held = true
                        sessionMedia.notifySystemAudioFocusChange(MediaSession.SYSTEM_AUDIO_FOCUS_GAIN)
                    }
                    AudioManager.AUDIOFOCUS_LOSS -> {
                        held = false
                        sessionMedia.notifySystemAudioFocusChange(MediaSession.SYSTEM_AUDIO_FOCUS_PERMANENT_LOSS)
                        pause()
                    }
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                        held = false
                        sessionMedia.notifySystemAudioFocusChange(MediaSession.SYSTEM_AUDIO_FOCUS_TRANSIENT_LOSS)
                    }
                }
            }, main).build()
        request = next
        held = manager.requestAudioFocus(next) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        if (held) (entry()?.media ?: media)?.notifySystemAudioFocusChange(MediaSession.SYSTEM_AUDIO_FOCUS_GAIN)
        else pause()
        return held
    }
    private fun abandon() {
        val old = request
        policy.clear()
        request = null
        held = false
        if (old != null) manager.abandonAudioFocusRequest(old)
    }
    fun hasRequestFor(session: Any): Boolean = source?.session === session && request != null
    fun pauseFor(session: Any) { if (source?.session === session) pause() }
    fun abandonFor(session: Any, retainSession: Boolean) {
        if (source?.session !== session) return
        if (retainSession) abandon() else clear()
    }
    fun clear() { abandon(); source = null; media = null; documentGeneration = null }
}
