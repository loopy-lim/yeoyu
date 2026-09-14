package dev.browser

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Picture
import android.graphics.Rect
import android.graphics.drawable.Drawable
import android.graphics.drawable.PictureDrawable

/** Records clipping now; replay never reads an outgoing, detached or recycled View. */
internal fun spaceCoverDrawable(
    bitmap: Bitmap, width: Int, height: Int, clip: (Canvas) -> Boolean,
): Drawable? {
    if (width <= 0 || height <= 0 || bitmap.isRecycled) return null
    val picture = Picture()
    val canvas = picture.beginRecording(width, height)
    try {
        canvas.clipRect(0, 0, width, height)
        if (!clip(canvas) || canvas.clipBounds.isEmpty) return null
        canvas.drawBitmap(bitmap, null, Rect(0, 0, width, height), Paint(Paint.FILTER_BITMAP_FLAG))
    } finally {
        picture.endRecording()
    }
    return PictureDrawable(picture).apply { setBounds(0, 0, width, height) }
}
