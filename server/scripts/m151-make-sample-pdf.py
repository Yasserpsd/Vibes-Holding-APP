# M151 — builds the sample PDF the live test sends to the advisor: a short feasibility summary with a deliberate
# unit-economics problem the advisor should find (CAC above the order margin, three months of runway).
# Run: python scripts/m151-make-sample-pdf.py  → scripts/m151-sample.pdf (reportlab; Arabic lines via arabic_reshaper + bidi when present).
import os
import sys

from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

OUT = os.path.join(os.path.dirname(__file__), "m151-sample.pdf")

try:
    import arabic_reshaper
    from bidi.algorithm import get_display

    def ar(text):
        return get_display(arabic_reshaper.reshape(text))

    pdfmetrics.registerFont(TTFont("Arial", r"C:\Windows\Fonts\arial.ttf"))
    ARABIC = True
except Exception:  # noqa: BLE001 — no shaping on this machine: Latin-only file
    ARABIC = False

LINES = [
    ("H", "Riyadh Cloud Kitchen — Feasibility Summary (confidential draft, Oct 2026)"),
    ("", ""),
    ("S", "1. Concept"),
    ("", "Delivery-only kitchen in north Riyadh serving three virtual brands (burgers, Saudi breakfast, salads)"),
    ("", "through HungerStation, Jahez and ToYou. Launch planned for Q1 2027. Team: two founders, one chef."),
    ("", ""),
    ("S", "2. Key numbers (monthly, steady state after month 6)"),
    ("", "Orders: 4,800 per month      Average order value: 45 SAR      Revenue: 216,000 SAR"),
    ("", "Food cost: 38%      Packaging: 6%      Aggregator commission: 25%      Delivery promo share: 9%"),
    ("", "Gross margin after platform costs: 22% = 9.9 SAR per order"),
    ("", "Rent + utilities: 28,000 SAR      Salaries: 41,000 SAR      Marketing: 36,000 SAR"),
    ("", "Customer acquisition cost (paid social + platform ads): 180 SAR per new customer"),
    ("", "Repeat rate: 1.6 orders per customer per quarter      Churn: 71% after the first order"),
    ("", ""),
    ("S", "3. Cash position"),
    ("", "Cash in bank: 310,000 SAR      Monthly burn until month 6: 95,000 SAR      Runway: about 3 months"),
    ("", "Loan: none      Receivables: none (aggregators settle weekly)"),
    ("", ""),
    ("S", "4. The ask"),
    ("", "A partner entering with 2,000,000 SAR for 8% of the founding contract (implied valuation 25,000,000 SAR)."),
    ("", "Use of funds: second kitchen in Jeddah (1.2M), marketing (0.5M), working capital (0.3M)."),
    ("", ""),
    ("S", "5. Risks listed by the founders"),
    ("", "Aggregator commission increases; chef retention; competition from 40+ cloud kitchens in Riyadh."),
    ("", ""),
    ("A", "ملخص بالعربية: مطبخ سحابي في شمال الرياض بثلاث علامات افتراضية، 4,800 طلب شهريًا بمتوسط 45 ريالًا، تكلفة اكتساب العميل 180 ريالًا، ورصيد نقدي يكفي ثلاثة أشهر، والمطلوب شريك بمبلغ مليوني ريال مقابل 8%."),
]

c = canvas.Canvas(OUT, pagesize=A4)
width, height = A4
y = height - 60
for kind, text in LINES:
    if kind == "A":
        if not ARABIC:
            continue
        c.setFont("Arial", 11)
        c.drawRightString(width - 50, y, ar(text))
        y -= 18
        continue
    c.setFont("Helvetica-Bold" if kind in ("H", "S") else "Helvetica", 14 if kind == "H" else 11)
    c.drawString(50, y, text)
    y -= 22 if kind in ("H", "S") else 16
    if y < 80:
        c.showPage()
        y = height - 60
c.setFont("Helvetica", 8)
c.drawString(50, 40, "Prepared for the Investors Club advisor test (M151). Numbers are fictional.")
c.save()
print(OUT, os.path.getsize(OUT), "bytes", "arabic line:", ARABIC)
sys.exit(0)
