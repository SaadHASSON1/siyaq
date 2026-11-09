package app.siyaq.reader

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

// The page fills the screen, under the status and navigation bars: it keeps clear of them itself, from the sizes
// SiyaqPlugin gives it, so the toolbar's colour reaches the top of the screen.
class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}
