"""Visual RBAC flow PDF for the e-comm admin panel. Run: python scripts/make-rbac-flow-pdf.py"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas

W, H = A4
M = 18 * mm

INDIGO = HexColor("#3730A3")
INDIGO_LT = HexColor("#EEF2FF")
TEAL = HexColor("#0F766E")
TEAL_LT = HexColor("#CCFBF1")
RED = HexColor("#B91C1C")
RED_LT = HexColor("#FEE2E2")
AMBER = HexColor("#B45309")
AMBER_LT = HexColor("#FEF3C7")
SLATE = HexColor("#1E293B")
GREY = HexColor("#64748B")
GREY_LT = HexColor("#F1F5F9")
GREEN = HexColor("#15803D")
GREEN_LT = HexColor("#DCFCE7")
BLUE_LT = HexColor("#DBEAFE")
PURP_LT = HexColor("#F3E8FF")
WHITE = HexColor("#FFFFFF")

OUT = "docs/rbac-flow.pdf"


def new_page(c, num, title, subtitle=""):
    c.setFillColor(INDIGO)
    c.rect(0, H - 26 * mm, W, 26 * mm, stroke=0, fill=1)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 17)
    c.drawString(M, H - 14 * mm, title)
    if subtitle:
        c.setFont("Helvetica", 9.5)
        c.setFillColor(HexColor("#C7D2FE"))
        c.drawString(M, H - 20 * mm, subtitle)
    c.setFont("Helvetica", 8)
    c.setFillColor(HexColor("#C7D2FE"))
    c.drawRightString(W - M, H - 20 * mm, f"RBAC Visual Guide  •  p.{num}")
    c.setFillColor(SLATE)


def footer(c):
    c.setFont("Helvetica", 7.5)
    c.setFillColor(GREY)
    c.drawCentredString(
        W / 2, 10 * mm, "Backend is the security boundary  •  Frontend checks are UX only  •  Never trust the client"
    )


def box(c, x, y, w, h, fill, stroke=None, radius=3 * mm):
    c.setFillColor(fill)
    c.setStrokeColor(stroke or fill)
    c.setLineWidth(0.6)
    c.roundRect(x, y, w, h, radius, stroke=1, fill=1)


def text_c(c, x, y, s, size=10, bold=True, color=SLATE, font="Helvetica"):
    c.setFillColor(color)
    c.setFont(f"{font}-Bold" if bold else font, size)
    c.drawCentredString(x, y, s)


def text_l(c, x, y, s, size=9, bold=False, color=SLATE):
    c.setFillColor(color)
    c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
    c.drawString(x, y, s)


def arrow_down(c, x, y_top, length=10 * mm, color=GREY):
    c.setStrokeColor(color)
    c.setLineWidth(1.4)
    c.line(x, y_top, x, y_top - length)
    c.setFillColor(color)
    p = c.beginPath()
    p.moveTo(x, y_top - length - 3 * mm)
    p.lineTo(x - 2.2 * mm, y_top - length)
    p.lineTo(x + 2.2 * mm, y_top - length)
    p.close()
    c.drawPath(p, stroke=0, fill=1)


def arrow_right(c, x, y, length=12 * mm, color=GREY):
    c.setStrokeColor(color)
    c.setLineWidth(1.4)
    c.line(x, y, x + length, y)
    c.setFillColor(color)
    p = c.beginPath()
    p.moveTo(x + length + 3 * mm, y)
    p.lineTo(x + length, y - 2.2 * mm)
    p.lineTo(x + length, y + 2.2 * mm)
    p.close()
    c.drawPath(p, stroke=0, fill=1)


def chip(c, cx, y, label, fill=GREEN_LT, color=GREEN, size=8.5):
    w = c.stringWidth(label, "Helvetica-Bold", size) + 10 * mm
    box(c, cx - w / 2, y - 4 * mm, w, 8 * mm, fill, radius=4 * mm)
    text_c(c, cx, y - 0.5 * mm, label, size=size, color=color)
    return w


def callout(c, y, title, body, fill=AMBER_LT, border=AMBER):
    box(c, M, y - 16 * mm, W - 2 * M, 22 * mm, fill, border)
    text_l(c, M + 5 * mm, y, f"⚠  {title}", size=10, bold=True, color=border)
    text_l(c, M + 5 * mm, y - 6 * mm, body, size=9, color=SLATE)


# ---------------------------------------------------------------- page 1: cover
c = canvas.Canvas(OUT, pagesize=A4)
new_page(c, 1, "E-Commerce Admin RBAC — Visual Flow Guide", "How authorization works in our project, end to end")
y = H - 45 * mm
text_l(c, M, y, "Goal", size=13, bold=True, color=INDIGO)
y -= 7 * mm
for line in [
    "Admins create roles and assign module + action permissions — entirely from the admin panel.",
    "No code change is ever needed to manage who can do what. The backend enforces everything.",
]:
    text_l(c, M, y, line, size=10)
    y -= 5.5 * mm
y -= 4 * mm
# layer stack visual
layers = [
    ("Admin User", "admin@example.com  •  one or more roles", INDIGO, WHITE),
    ("Role(s)", "User Manager  •  reusable permission bundle", TEAL, WHITE),
    ("Permissions", "users.view  •  users.ban  •  orders.refund", GREEN, WHITE),
    ("Module + Action", "users  +  ban  =  atomic capability", AMBER, WHITE),
]
cx = W / 2
for name, desc, fill, tcol in layers:
    box(c, cx - 75 * mm, y - 13 * mm, 150 * mm, 14 * mm, fill)
    text_c(c, cx, y - 4 * mm, name, size=12, color=tcol)
    c.setFont("Helvetica", 8.5)
    c.setFillColor(HexColor("#E0E7FF") if fill == INDIGO else HexColor("#FFFFFF"))
    if fill in (GREEN, AMBER):
        c.setFillColor(HexColor("#052E16") if fill == GREEN else HexColor("#451A03"))
    c.drawCentredString(cx, y - 9.5 * mm, desc)
    y -= 14 * mm
    if name != "Module + Action":
        arrow_down(c, cx, y + 2.5 * mm, 7 * mm)
        y -= 8 * mm
y -= 2 * mm
callout(
    c, y, "Core principle",
    "Hiding a button is NOT security. Every protected API re-authorizes the caller — direct API calls without",
)
text_l(c, M + 5 * mm, y - 12 * mm, "permission always get 403, no matter what the UI shows.", size=9)
footer(c)
c.showPage()

# ------------------------------------------------- page 2: request lifecycle
new_page(c, 2, "Request Authorization Flow", "What happens on every protected admin API call (§4 of the flow doc)")
steps = [
    ("1. Login", "email + password (+ 2FA / session)", BLUE_LT, INDIGO),
    ("2. Authenticate", "verify credentials → session / token", BLUE_LT, INDIGO),
    ("3. Request hits API", "e.g.  POST /admin/users/:id/ban", GREY_LT, SLATE),
    ("4. Auth middleware", "who are you? → admin identity", BLUE_LT, INDIGO),
    ("5. Resolve roles", "active roles of this admin", TEAL_LT, TEAL),
    ("6. Resolve permissions", "union of role grants  •  Redis → DB fallback", TEAL_LT, TEAL),
    ("7. Check required key", "does the set contain  users.ban ?", GREEN_LT, GREEN),
    ("8. Scope check (if any)", "ownership / region — only where needed", PURP_LT, INDIGO),
    ("9a. ALLOW → execute", "controller / service runs", GREEN_LT, GREEN),
    ("9b. DENY → 403 + log", "missing permission → security event", RED_LT, RED),
    ("10. Audit log", "actor • target • before/after • IP • time", AMBER_LT, AMBER),
]
y = H - 38 * mm
bx, bw, bh = M + 30 * mm, W - 2 * M - 60 * mm, 11.5 * mm
rail_x = M + 12 * mm
c.setStrokeColor(GREY)
c.setLineWidth(1.6)
c.line(rail_x, y + 4 * mm, rail_x, y - len(steps) * 15.2 * mm)
for i, (t, d, fill, tcol) in enumerate(steps):
    box(c, bx, y - bh, bw, bh, fill)
    text_l(c, bx + 4 * mm, y - 4.6 * mm, t, size=9.5, bold=True, color=tcol)
    c.setFont("Helvetica", 8)
    c.setFillColor(SLATE)
    c.drawString(bx + 42 * mm, y - 4.6 * mm, d)
    c.setFillColor(tcol)
    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString(rail_x, y - 4.6 * mm, str(i + 1) if i < 9 else ("✓" if i == 8 else ("✕" if i == 9 else "◈")))
    y -= 15.2 * mm
footer(c)
c.showPage()

# ------------------------------------------- page 3: authn vs authz + DB model
new_page(c, 3, "Separation of Concerns + Data Model", "Three different questions — three different mechanisms")
y = H - 40 * mm
cols = [
    ("AUTHENTICATION", "Who are you?", "login • 2FA • session", BLUE_LT, INDIGO),
    ("AUTHORIZATION", "What can you do?", "roles → permissions", GREEN_LT, GREEN),
    ("AUDIT", "What did you do?", "actor • action • IP • time", AMBER_LT, AMBER),
]
cw = (W - 2 * M - 12 * mm) / 3
for i, (t, q, ex, fill, tcol) in enumerate(cols):
    x = M + i * (cw + 6 * mm)
    box(c, x, y - 24 * mm, cw, 26 * mm, fill, tcol)
    text_c(c, x + cw / 2, y - 6 * mm, t, size=10, color=tcol)
    text_c(c, x + cw / 2, y - 12 * mm, q, size=9, bold=False, color=SLATE)
    text_c(c, x + cw / 2, y - 18 * mm, ex, size=8, bold=False, color=GREY)
y -= 34 * mm
text_l(c, M, y, "Database model (our Prisma schema)", size=13, bold=True, color=INDIGO)
y -= 9 * mm
tables = [
    ("admin_users", ["id", "email", "status", "permissionsVersion"]),
    ("admin_roles", ["id", "key", "status", "isSystem"]),
    ("permissions", ["id", "key (module.action)", "module / action", "status"]),
    ("admin_user_roles", ["admin_id  →  role_id"]),
    ("admin_role_permissions", ["role_id  →  permission_id"]),
    ("admin_audit_log", ["actor • action • target", "before / after • ip"]),
]
tw = (W - 2 * M - 10 * mm) / 3
th = 26 * mm
for i, (t, rows) in enumerate(tables):
    x = M + (i % 3) * (tw + 5 * mm)
    yy = y - (i // 3) * (th + 6 * mm) - th
    box(c, x, yy, tw, th, WHITE, INDIGO)
    c.setFillColor(INDIGO)
    c.rect(x, yy + th - 8 * mm, tw, 8 * mm, stroke=0, fill=1)
    text_c(c, x + tw / 2, yy + th - 5.8 * mm, t, size=8.5, color=WHITE)
    for j, r in enumerate(rows):
        text_l(c, x + 3 * mm, yy + th - 13 * mm - j * 4.2 * mm, f"•  {r}", size=7.5, color=SLATE)
y -= 2 * (th + 6 * mm) + 8 * mm
text_l(c, M, y, "Union rule:  effective permissions = ACTIVE roles only, ACTIVE permissions only.", size=9, bold=True)
y -= 5 * mm
text_l(c, M, y, "Super Admin implies ALL permissions implicitly (never stored per-row).", size=9)
footer(c)
c.showPage()

# ------------------------------------------- page 4: example + matrix + guards
new_page(c, 4, "Example: Users Module + Matrix + Guards", "Permission-driven, not role-name-driven")
y = H - 40 * mm
text_l(c, M, y, "One module, many reusable bundles", size=12, bold=True, color=TEAL)
y -= 8 * mm
perms = ["view", "view_details", "add", "update", "delete", "ban", "unban", "export"]
x = M
for p in perms:
    label = f"users.{p}"
    w = c.stringWidth(label, "Helvetica-Bold", 8) + 6 * mm
    if x + w > W - M:
        x = M
        y -= 9 * mm
    box(c, x, y - 6 * mm, w, 7.5 * mm, GREEN_LT, GREEN)
    text_c(c, x + w / 2, y - 1.6 * mm, label, size=8, color=GREEN)
    x += w + 2.5 * mm
y -= 13 * mm
roles = [
    ("Customer Support", ["view", "view_details", "ban"], TEAL_LT, TEAL),
    ("User Manager", ["view", "view_details", "add", "update", "ban", "unban"], BLUE_LT, INDIGO),
    ("Reporting Staff", ["view", "export"], PURP_LT, INDIGO),
]
for name, grants, fill, tcol in roles:
    box(c, M, y - 8 * mm, W - 2 * M, 10 * mm, fill, tcol)
    text_l(c, M + 4 * mm, y - 1.8 * mm, f"{name}:  " + ",  ".join(f"users.{g}" for g in grants), size=8.5, bold=True, color=tcol)
    y -= 12 * mm
y -= 2 * mm
text_l(c, M, y, "Backend guards (one line per endpoint, never role-name checks in controllers)", size=12, bold=True, color=TEAL)
y -= 8 * mm
c.setFont("Helvetica-Bold", 9)
guards = [
    ("requirePerm('users.view')", "caller must hold this key"),
    ("requireAnyPerm([...])", "ANY one suffices"),
    ("requireAllPerms([...])", "ALL of these must hold"),
]
for g, d in guards:
    box(c, M, y - 6.5 * mm, 62 * mm, 8 * mm, GREY_LT)
    text_l(c, M + 3 * mm, y - 1.6 * mm, g, size=8.5, bold=True, color=INDIGO)
    text_l(c, M + 67 * mm, y - 1.6 * mm, d, size=9, color=SLATE)
    y -= 10.5 * mm
y -= 2 * mm
callout(c, y, "Privilege-escalation guard",
    "A non–Super Admin can only grant permissions they hold themselves (checked server-side).")
footer(c)
c.showPage()

# ------------------------------------------- page 5: cache + protections + e2e
new_page(c, 5, "Caching, Protection Rules & End-to-End", "Fast reads, instant revocation, no lockouts")
y = H - 40 * mm
text_l(c, M, y, "Redis cache with versioning (reads are fast, changes win instantly)", size=12, bold=True, color=TEAL)
y -= 9 * mm
stages = ["Session", "admin:{id}:perms", "version match?", "DB fallback"]
sx = M + 4 * mm
for i, s in enumerate(stages):
    box(c, sx, y - 9 * mm, 36 * mm, 11 * mm, TEAL_LT if i < 3 else AMBER_LT, TEAL if i < 3 else AMBER)
    text_c(c, sx + 18 * mm, y - 2.6 * mm, s, size=8, color=TEAL if i < 3 else AMBER)
    if i < 3:
        arrow_right(c, sx + 36 * mm, y - 3.5 * mm, 6 * mm)
    sx += 42 * mm
y -= 17 * mm
text_l(c, M, y, "Every role / assignment / status change bumps permissionsVersion + drops the cache key.", size=9, bold=True)
y -= 5.5 * mm
text_l(c, M, y, "A missed cache delete is still safe — the version check rejects the stale entry.", size=9)
y -= 9 * mm
text_l(c, M, y, "Super Admin protection rails", size=12, bold=True, color=RED)
y -= 8 * mm
rails = [
    "super_admin is a system role — cannot be deleted or deactivated",
    "Only a Super Admin can grant the super_admin role",
    "Cannot remove your own super_admin role  •  cannot change your own status",
    "Cannot deactivate the last active Super Admin",
    "All role / permission changes are audited (before → after)",
]
for r in rails:
    box(c, M, y - 6 * mm, W - 2 * M, 7.5 * mm, RED_LT, RED)
    text_l(c, M + 4 * mm, y - 1.2 * mm, f"✕   {r}", size=8.5, bold=True, color=RED)
    y -= 10 * mm
y -= 3 * mm
text_l(c, M, y, "End-to-end: Support bans a user", size=12, bold=True, color=INDIGO)
y -= 7 * mm
flow = ["UI shows Ban (has users.ban)", "POST /admin/users/:id/ban", "backend checks users.ban", "ban + audit row"]
fx = M
for i, f in enumerate(flow):
    w = 40 * mm
    box(c, fx, y - 8 * mm, w, 10 * mm, BLUE_LT if i < 3 else AMBER_LT, INDIGO if i < 3 else AMBER)
    text_c(c, fx + w / 2, y - 1.5 * mm, f, size=7.5, color=INDIGO if i < 3 else AMBER)
    if i < 3:
        arrow_right(c, fx + w, y - 3 * mm, 4 * mm)
    fx += w + 4 * mm
y -= 14 * mm
text_l(c, M, y, "Attacker calls the same API without users.ban → 403 + security event. UI state is irrelevant.", size=9, bold=True, color=RED)
footer(c)
c.showPage()
c.save()
print(f"Wrote {OUT}")
