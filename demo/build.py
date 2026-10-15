"""Construit la démo autonome (artifact) à partir des fichiers de l'application."""
import re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "demo" / "out"
OUT.mkdir(parents=True, exist_ok=True)

css = (ROOT / "public/assets/app.css").read_text()
# Thème : respecter le choix explicite du lecteur (data-theme) en plus du réglage système
m = re.search(r"@media \(prefers-color-scheme: dark\) \{\n  :root \{(.*?)\n  \}\n\}", css, re.S)
dark = m.group(1)
css = css.replace(m.group(0),
    "@media (prefers-color-scheme: dark) {\n  :root:not([data-theme=\"light\"]) {" + dark + "\n  }\n}\n"
    ":root[data-theme=\"dark\"] {" + dark + "\n}")

DEMO_CSS = """
.demo-bar { background: var(--accent-soft); border-bottom: 1px solid var(--line); font-size: 13.5px; }
.demo-bar .inner { max-width: 1240px; margin: 0 auto; padding: 8px 16px; display: flex; gap: 8px 14px; align-items: center; flex-wrap: wrap; }
.demo-bar strong { color: var(--accent); }
.demo-bar span { flex: 1; min-width: 200px; color: var(--ink); }
.demo-bar a, .demo-bar button { font: inherit; font-weight: 600; color: var(--accent); background: none; border: none; cursor: pointer; padding: 6px 4px; text-decoration: underline; text-underline-offset: 3px; }
"""

shared = (ROOT / "public/assets/shared.js").read_text()
mock = (ROOT / "demo/mock.js").read_text()
mock = mock.replace("/*DEMO_GROUPS*/[]", (ROOT / "demo/lots-demo.json").read_text())

def page(src, app_js, bar_html, full_doc):
    html = src.read_text()
    title = re.search(r"<title>(.*?)</title>", html).group(1)
    body = re.search(r"<body[^>]*>(.*)</body>", html, re.S).group(1)
    body_class = (re.search(r'<body class="([^"]*)"', html) or [None, ""])[1]
    body = re.sub(r"<script[^>]*src=[^>]*></script>\s*", "", body)
    body = re.sub(r"<script>window.API_URL[^<]*</script>\s*", "", body)
    scripts = "<script>\n" + shared + "\n</script>\n<script>\n" + mock + "\n</script>\n<script>\n" + app_js + "\n</script>\n"
    if body_class:
        scripts = f"<script>document.body.classList.add('{body_class}');</script>\n" + scripts
    content = f"<title>{title}</title>\n<style>\n{css}\n{DEMO_CSS}\n</style>\n{bar_html}\n{body}\n{scripts}"
    if full_doc:
        return ('<!doctype html><html lang="fr"><head><meta charset="utf-8">'
                '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head>'
                f'<body class="{body_class}">\n{content}</body></html>')
    return content

reset = ('<button type="button" onclick="window.DEMO_RESET();location.reload()">Réinitialiser</button>')
bar_res = ('<div class="demo-bar"><div class="inner"><span><strong>Démo</strong> · données fictives, gardées dans votre navigateur. '
           'Essayez le lot 0102 (ou le nom Martin) : des badges de l\'ancienne centrale, fictifs, vous sont proposés. Email pour modifier : exemple.dupont@exemple.fr ; le code s\'affiche à l\'écran.</span>'
           '<a href="admin.html">Voir l\'administration →</a>' + reset + '</div></div>')
bar_adm = ('<div class="demo-bar"><div class="inner"><span><strong>Démo</strong> · mot de passe : <strong>demo</strong>. '
           'Données fictives, gardées dans votre navigateur.</span>'
           '<a href="./" onclick="if(history.length>1){history.back();return false}">← Page résident</a>' + reset + '</div></div>')

(OUT / "badges-demo.html").write_text(page(ROOT / "public/index.html", (ROOT / "public/assets/app.js").read_text(), bar_res, False))
(OUT / "admin.html").write_text(page(ROOT / "public/admin/index.html", (ROOT / "public/assets/admin.js").read_text(), bar_adm, True))
print("ok", [p.name for p in OUT.iterdir()])
