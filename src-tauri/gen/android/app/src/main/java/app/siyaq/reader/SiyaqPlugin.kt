package app.siyaq.reader

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import app.tauri.Logger
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class PickArgs {
  var mimeTypes: Array<String>? = null
  var folder: String? = null
}

@InvokeArg
class BarsArgs {
  var dark: Boolean = false
}

@InvokeArg
class SaveArgs {
  lateinit var source: String
  lateinit var name: String
  var mime: String? = null
}

// Books in and files out: the system's file picker and "save to" screen, and books sent from other apps
// ("Open with", "Share"). Every book is copied into the app's own folder, so it opens again after a restart.
@TauriPlugin
class SiyaqPlugin(private val activity: Activity) : Plugin(activity) {
  private var opened: String? = null
  private var sharedText: String? = null
  private var folder = "books"
  private var saving: SaveArgs? = null

  private var insets = "{}"

  override fun load(webView: WebView) {
    take(activity.intent)
    // The status bar, navigation bar, camera cut-out and keyboard: their sizes go to the page as CSS variables
    // (--inset-top and so on), whenever they change, so it lays itself out around them.
    ViewCompat.setOnApplyWindowInsetsListener(webView) { v, all ->
      val bars = all.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val ime = all.getInsets(WindowInsetsCompat.Type.ime())
      val d = v.resources.displayMetrics.density
      insets = "{\"top\":${bars.top / d},\"right\":${bars.right / d},\"bottom\":${maxOf(bars.bottom, ime.bottom) / d},\"left\":${bars.left / d},\"keyboard\":${ime.bottom > 0}}"
      webView.post { webView.evaluateJavascript("window.siyaqInsets&&siyaqInsets($insets)", null) }
      WindowInsetsCompat.CONSUMED
    }
    webView.post { webView.requestApplyInsets() }
  }

  // The page asks for them once it is ready, and says whether it is dark (for the bars' icons).
  @Command
  fun bars(invoke: Invoke) {
    val args = invoke.parseArgs(BarsArgs::class.java)
    activity.runOnUiThread {
      val c = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
      c.isAppearanceLightStatusBars = !args.dark
      c.isAppearanceLightNavigationBars = !args.dark
      val r = JSObject(insets)
      invoke.resolve(r)
    }
  }

  override fun onNewIntent(intent: Intent) {
    take(intent)
  }

  private fun take(intent: Intent?) {
    if (intent == null) return
    // Text selected in another app, sent with "Siyaq" from its selection menu: its meaning, here.
    if (intent.action == Intent.ACTION_PROCESS_TEXT) {
      sharedText = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()?.trim()?.take(400)
      intent.action = Intent.ACTION_MAIN
      return
    }
    val uri: Uri? = when (intent.action) {
      Intent.ACTION_VIEW -> intent.data
      Intent.ACTION_SEND ->
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_STREAM)
      else -> null
    }
    if (uri == null) return
    intent.action = Intent.ACTION_MAIN // taken: not again when the app comes back
    Thread {
      try { opened = copyIn(uri, "books") } catch (e: Exception) { Logger.error("Siyaq: could not open the book: ${e.message}") }
    }.start()
  }

  @Command
  fun takeOpened(invoke: Invoke) {
    val r = JSObject()
    r.put("path", opened)
    r.put("text", sharedText)
    opened = null
    sharedText = null
    invoke.resolve(r)
  }

  @Command
  fun pickFile(invoke: Invoke) {
    val args = invoke.parseArgs(PickArgs::class.java)
    folder = args.folder ?: "books"
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
    intent.addCategory(Intent.CATEGORY_OPENABLE)
    intent.type = "*/*"
    args.mimeTypes?.let { intent.putExtra(Intent.EXTRA_MIME_TYPES, it) }
    startActivityForResult(invoke, intent, "picked")
  }

  @ActivityCallback
  fun picked(invoke: Invoke, result: ActivityResult) {
    val uri = result.data?.data
    val r = JSObject()
    if (result.resultCode != Activity.RESULT_OK || uri == null) {
      r.put("path", null)
      invoke.resolve(r)
      return
    }
    Thread {
      try {
        r.put("path", copyIn(uri, folder))
        invoke.resolve(r)
      } catch (e: Exception) {
        invoke.reject(e.message ?: "could not read the file")
      }
    }.start()
  }

  @Command
  fun saveFile(invoke: Invoke) {
    val args = invoke.parseArgs(SaveArgs::class.java)
    saving = args
    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
    intent.addCategory(Intent.CATEGORY_OPENABLE)
    intent.type = args.mime ?: "application/octet-stream"
    intent.putExtra(Intent.EXTRA_TITLE, args.name)
    startActivityForResult(invoke, intent, "saved")
  }

  @ActivityCallback
  fun saved(invoke: Invoke, result: ActivityResult) {
    val uri = result.data?.data
    val args = saving
    val r = JSObject()
    if (result.resultCode != Activity.RESULT_OK || uri == null || args == null) {
      r.put("saved", false)
      invoke.resolve(r)
      return
    }
    Thread {
      try {
        activity.contentResolver.openOutputStream(uri, "wt")!!.use { out -> File(args.source).inputStream().use { it.copyTo(out) } }
        r.put("saved", true)
        invoke.resolve(r)
      } catch (e: Exception) {
        invoke.reject(e.message ?: "could not save the file")
      }
    }.start()
  }

  private fun nameOf(uri: Uri): String {
    var name: String? = null
    if (uri.scheme == "content") {
      try {
        activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
          if (c.moveToFirst() && !c.isNull(0)) name = c.getString(0)
        }
      } catch (_: Exception) {}
    }
    if (name.isNullOrBlank()) name = uri.lastPathSegment?.substringAfterLast('/')
    var n = (name ?: "book").replace(Regex("[\\\\/:*?\"<>|]"), "_")
    if (!n.contains('.')) {
      when (activity.contentResolver.getType(uri)) {
        "application/pdf" -> n += ".pdf"
        "application/epub+zip" -> n += ".epub"
        "application/json" -> n += ".json"
      }
    }
    return n
  }

  private fun sizeOf(uri: Uri): Long {
    try {
      activity.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
        if (c.moveToFirst() && !c.isNull(0)) return c.getLong(0)
      }
    } catch (_: Exception) {}
    return -1
  }

  // Into the app's folder, under the book's own name; another book with the same name gets "name (2).pdf".
  private fun copyIn(uri: Uri, into: String): String {
    val dir = File(activity.filesDir, into).apply { mkdirs() }
    val name = nameOf(uri)
    val size = sizeOf(uri)
    val stem = name.substringBeforeLast('.', name)
    val ext = if (name.contains('.')) "." + name.substringAfterLast('.') else ""
    var out = File(dir, name)
    var i = 2
    while (out.exists() && !(size >= 0 && out.length() == size)) {
      out = File(dir, "$stem ($i)$ext")
      i++
    }
    val tmp = File(dir, out.name + ".part")
    activity.contentResolver.openInputStream(uri)!!.use { input -> tmp.outputStream().use { input.copyTo(it) } }
    if (out.exists()) out.delete()
    tmp.renameTo(out)
    return out.absolutePath
  }
}
