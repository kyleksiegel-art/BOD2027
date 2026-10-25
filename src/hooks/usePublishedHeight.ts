import { useLayoutEffect, useRef } from 'react'

/**
 * Publish an element's rendered height (padding, so the safe-area insets, included) as a CSS
 * custom property on <html>, kept current as it resizes. The shell's fixed bars use it so the
 * page can reserve exactly their space, and Enter's Save bar can sit just above the tab bar.
 */
export function usePublishedHeight<T extends HTMLElement>(cssVar: `--${string}`) {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    const publish = () => root.style.setProperty(cssVar, `${el.offsetHeight}px`)
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => ro.disconnect()
  }, [cssVar])
  return ref
}
