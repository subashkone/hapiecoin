// Inline <head> script that applies the stored theme before hydration. It must equal
// `themeInitScript("hapiecoin.theme", "dark")` from @hapiecoin/ui; the root layout cannot import that
// package (it creates React contexts at import time, which server components reject), so the string is
// duplicated here and pinned by src/lib/theme-init.test.ts.
export const THEME_STORAGE_KEY = "hapiecoin.theme";
export const THEME_INIT_SCRIPT =
  `(function(){try{var k="hapiecoin.theme",d="dark",t=localStorage.getItem(k);` +
  `if(t!=="light"&&t!=="dark"&&t!=="system")t=d;` +
  `var r=t==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):t;` +
  `var c=document.documentElement.classList;c.remove("light","dark");c.add(r);` +
  `document.documentElement.dataset.theme=r;document.documentElement.style.colorScheme=r;}catch(e){}})();`;
