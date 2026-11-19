import config from 'virtual:ai2h-intake/browser'
import css from './drawer.css?inline'
import { mountIntakeDrawer } from './drawer.js'

const STYLE_ID = 'ai2h-intake-styles'

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = css
  document.head.append(style)
}

ensureStyles()
document.addEventListener('astro:after-swap', ensureStyles)
mountIntakeDrawer(config)
