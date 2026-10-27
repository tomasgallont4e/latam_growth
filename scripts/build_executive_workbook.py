#!/usr/bin/env python3
"""Blank executive scorecard. Targets and actuals are empty on purpose."""
import json
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "sample/executive/data/preview.json").read_text())
OUT = ROOT / "docs/latam-executive-metrics.xlsx"

MONTHS = DATA["months"]
METRICS = DATA["metrics"]
NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def col(n):
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def cell(ref, style, value=None, formula=None):
    if formula is not None:
        return f'<c r="{ref}" s="{style}"><f>{escape(formula)}</f></c>'
    if value is None:
        return f'<c r="{ref}" s="{style}"/>'
    if isinstance(value, (int, float)):
        return f'<c r="{ref}" s="{style}"><v>{value}</v></c>'
    return f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{escape(value)}</t></is></c>'


def input_style(unit):
    return {"Count": 2, "Currency": 3, "Rate": 4, "Number": 9}[unit]


def number_formula(unit, target, actual):
    if unit == "Rate":
        return f'IF(OR({target}="",{actual}=""),"",TEXT({actual},"0.0%")&" of "&TEXT({target},"0.0%"))'
    if unit == "Currency":
        return f'IF(OR({target}="",{actual}=""),"",TEXT({actual},"$#,##0")&" of "&TEXT({target},"$#,##0"))'
    if unit == "Number":
        return f'IF(OR({target}="",{actual}=""),"",TEXT({actual},"0.0")&" of "&TEXT({target},"0.0"))'
    return f'IF(OR({target}="",{actual}=""),"",TEXT({actual},"#,##0")&" of "&TEXT({target},"#,##0"))'


def pct_formula(direction, target, actual):
    if direction == "Lower":
        return f'IF(OR({target}="",{actual}="",{actual}=0),"",{target}/{actual})'
    return f'IF(OR({target}="",{actual}="",{target}=0),"",{actual}/{target})'


# styles: 0 default, 1 header, 2 count input, 3 currency input, 4 rate input,
# 5 percent formula, 6 wrapped text, 7 section label, 8 title
STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="{ns}">
  <numFmts count="5">
    <numFmt numFmtId="164" formatCode="#,##0"/>
    <numFmt numFmtId="165" formatCode="&quot;$&quot;#,##0"/>
    <numFmt numFmtId="166" formatCode="0%"/>
    <numFmt numFmtId="167" formatCode="0.0%"/>
    <numFmt numFmtId="168" formatCode="0.0"/>
  </numFmts>
  <fonts count="3">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><color rgb="FF11255A"/><name val="Calibri"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF11255A"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF4D6"/></patternFill></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="10">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>
    <xf numFmtId="165" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>
    <xf numFmtId="167" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>
    <xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="168" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>
  </cellXfs>
  <dxfs count="5">
    <dxf><font><b/><color rgb="FF1D4E89"/></font><fill><patternFill patternType="solid"><fgColor rgb="FFD6E4FF"/></patternFill></fill></dxf>
    <dxf><font><b/><color rgb="FF1F8A4C"/></font><fill><patternFill patternType="solid"><fgColor rgb="FFE7F5EC"/></patternFill></fill></dxf>
    <dxf><font><b/><color rgb="FFA86400"/></font><fill><patternFill patternType="solid"><fgColor rgb="FFFDF3E1"/></patternFill></fill></dxf>
    <dxf><font><b/><color rgb="FFC0362C"/></font><fill><patternFill patternType="solid"><fgColor rgb="FFFBEAEA"/></patternFill></fill></dxf>
    <dxf><font><b/><color rgb="FF1F8A4C"/></font><fill><patternFill patternType="solid"><fgColor rgb="FFE7F5EC"/></patternFill></fill></dxf>
  </dxfs>
</styleSheet>
""".format(ns=NS)


def rules(ref):
    # dxf 0 blue >=110% (not budget), 1 green >=100%, 2 amber >=90%, 3 red <90%
    # dxf 4 green within 10 points of budget, then amber within 20, else red uses dxf 3
    letter = "".join(ch for ch in ref.split(":")[0] if ch.isalpha())
    tests = [
        (1, f'AND({letter}3<>"",$E3="On budget",ABS({letter}3-1)<=0.1)', 4),
        (2, f'AND({letter}3<>"",$E3="On budget",ABS({letter}3-1)<=0.2)', 2),
        (3, f'AND({letter}3<>"",$E3="On budget")', 3),
        (4, f'AND({letter}3<>"",$E3<>"On budget",{letter}3>=1.1)', 0),
        (5, f'AND({letter}3<>"",$E3<>"On budget",{letter}3>=1)', 1),
        (6, f'AND({letter}3<>"",$E3<>"On budget",{letter}3>=0.9)', 2),
        (7, f'AND({letter}3<>"",$E3<>"On budget",{letter}3<0.9)', 3),
    ]
    body = []
    for priority, formula, dxf in tests:
        body.append(
            f'<cfRule type="expression" dxfId="{dxf}" priority="{priority}" stopIfTrue="1">'
            f"<formula>{escape(formula)}</formula></cfRule>"
        )
    return f'<conditionalFormatting sqref="{ref}">{"".join(body)}</conditionalFormatting>'


def scorecard():
    first = 8
    last_row = 2 + len(METRICS)
    rows = []
    # header groups
    top = []
    sub = []
    labels = ["Section", "Metric", "Definition", "Unit", "Better when", "Country split", "Suggested source"]
    for i, label in enumerate(labels, 1):
        sub.append(cell(f"{col(i)}2", 1, label))
    merges = []
    cond = []
    for mi, month in enumerate(MONTHS):
        base = first + mi * 4
        merges.append(f"{col(base)}1:{col(base + 3)}1")
        top.append(cell(f"{col(base)}1", 1, month["label"]))
        for offset, name in enumerate(["Target", "Actual", "Number", "% of target"]):
            sub.append(cell(f"{col(base + offset)}2", 1, name))
        cond.append(rules(f"{col(base + 3)}3:{col(base + 3)}{last_row}"))
    rows.append(f'<row r="1" ht="22" customHeight="1">{"".join(top)}</row>')
    rows.append(f'<row r="2" ht="22" customHeight="1">{"".join(sub)}</row>')
    for ri, m in enumerate(METRICS):
        r = 3 + ri
        direction = {"higher": "Higher", "lower": "Lower", "budget": "On budget"}[m["direction"]]
        unit = {"count": "Count", "currency": "Currency", "rate": "Rate", "decimal": "Number"}[m["unit"]]
        vals = [
            cell(f"A{r}", 0, m["section"]),
            cell(f"B{r}", 0, m["name"]),
            cell(f"C{r}", 6, m["definition"]),
            cell(f"D{r}", 0, unit),
            cell(f"E{r}", 0, direction),
            cell(f"F{r}", 0, m["split"]),
            cell(f"G{r}", 6, m["source"]),
        ]
        style = input_style(unit)
        for mi in range(len(MONTHS)):
            base = first + mi * 4
            t, a, n, p = col(base), col(base + 1), col(base + 2), col(base + 3)
            vals.append(cell(f"{t}{r}", style))
            vals.append(cell(f"{a}{r}", style))
            vals.append(cell(f"{n}{r}", 0, formula=number_formula(unit, f"{t}{r}", f"{a}{r}")))
            vals.append(cell(f"{p}{r}", 5, formula=pct_formula(direction, f"{t}{r}", f"{a}{r}")))
        rows.append(f'<row r="{r}" ht="48" customHeight="1">{"".join(vals)}</row>')
    last_col = col(first + len(MONTHS) * 4 - 1)
    widths = [(1, 24), (2, 32), (3, 78), (4, 12), (5, 14), (6, 16), (7, 46)]
    for i in range(len(MONTHS)):
        base = first + i * 4
        widths += [(base, 14), (base + 1, 14), (base + 2, 24), (base + 3, 14)]
    cols_xml = "".join(f'<col min="{i}" max="{i}" width="{w}" customWidth="1"/>' for i, w in widths)
    merge_xml = "".join(f'<mergeCell ref="{ref}"/>' for ref in merges)
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="{NS}">
  <dimension ref="A1:{last_col}{last_row}"/>
  <sheetViews><sheetView workbookViewId="0"><pane xSplit="2" ySplit="2" topLeftCell="C3" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>{cols_xml}</cols>
  <sheetData>{"".join(rows)}</sheetData>
  <autoFilter ref="A2:{last_col}{last_row}"/>
  <mergeCells count="{len(merges)}">{merge_xml}</mergeCells>
  {"".join(cond)}
  <pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
</worksheet>'''


def how_to_read():
    lines = [
        "How to read this scorecard",
        "This workbook is the list of executive metrics for the LATAM launch. Yellow cells are yours to fill. Number and % of target are formulas.",
        "One row is one metric for the whole app. Targets are app-wide. There is no target per country.",
        "Months run from October 2026 through March 2027. For each month: Target, Actual, Number, and % of target.",
        "Number shows the actual beside the target. A count of 10 against a target of 20 reads 10 of 20. A rate of 25% against a target of 40% reads 25.0% of 40.0%.",
        "% of target is actual divided by target when higher is better, and when the row is On budget. For Lower, it is target divided by actual, so a cheaper result still reads above 100%.",
        "Color on % of target: blue at 110% or above, green at 100% or above, amber from 90% up to 100%, red under 90%. On budget rows are green within 10 points of 100%, amber within 20, and red beyond that. Close to the budget is the goal, not the highest spend.",
        "Country split: Yes means the visitor or account country. Campaign geo means the country the ad targets. No means the number stays app-wide (LinkedIn page totals) when a country is selected on the dashboard.",
        "The dashboard country control is a checkbox labeled All, on by default, and a checklist of every country on the Countries sheet. Checking All shows these app-wide figures. Unchecking All clears the list so one or more countries can be chosen. Counts add up across the checked countries. Rates are recomputed from the combined counts. The percent still compares that selection with the app-wide target on this sheet.",
        "Suggested source is a hint from the current dashboard, not a decision. Billing for paid subscriptions and CAC is not connected yet.",
        "Sign-up to paid conversion: of the external sign-ups in the month, how many start a paid subscription. On the dashboard the number reads paid of sign-ups (for example 10 of 20). In this sheet the target and actual are the rate, and the number reads the actual rate of the target rate.",
        "CAC is ad spend divided by new sign-ups, for the day or for the month. Cost per paying customer is ad spend divided by new paid subscriptions.",
        "Form completion is form completed divided by form started.",
        "Customers, active customers, and accounts with a project are the level at month end. Activity is active customers divided by open accounts. Active means the customer used the app in the last 7 days.",
        "Cancellation is accounts canceled or deleted in the month divided by customers at the start of the month. Churn is customers who paid last month and are no longer paying, divided by everyone who was paying at the end of last month.",
        "Avg projects is projects divided by open accounts. Avg credits is credits spent in the last 7 days divided by active customers. Number rows use one decimal place.",
        "A preview with invented October figures is in sample/executive. Those numbers are not copied here.",
    ]
    rows = []
    for i, line in enumerate(lines, 1):
        style = 8 if i == 1 else 6
        height = 24 if i == 1 else 36
        rows.append(f'<row r="{i}" ht="{height}" customHeight="1">{cell(f"A{i}", style, line)}</row>')
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="{NS}">
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <cols><col min="1" max="1" width="120" customWidth="1"/></cols>
  <sheetData>{"".join(rows)}</sheetData>
</worksheet>'''


def countries():
    header = ["Country", "Seen in", "Include in the dashboard list"]
    rows = ['<row r="1" ht="22" customHeight="1">' + "".join(cell(f"{col(i)}1", 1, h) for i, h in enumerate(header, 1)) + "</row>"]
    for i, c in enumerate(DATA["countries"], 2):
        rows.append(
            f'<row r="{i}">'
            + cell(f"A{i}", 0, c["name"])
            + cell(f"B{i}", 0, c["seenIn"])
            + cell(f"C{i}", 2, c["include"])
            + "</row>"
        )
    last = 1 + len(DATA["countries"])
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="{NS}">
  <cols>
    <col min="1" max="1" width="24" customWidth="1"/>
    <col min="2" max="2" width="36" customWidth="1"/>
    <col min="3" max="3" width="32" customWidth="1"/>
  </cols>
  <sheetData>{"".join(rows)}</sheetData>
  <autoFilter ref="A1:C{last}"/>
</worksheet>'''


def workbook():
    sheets = [("How to read", "sheet1.xml"), ("Scorecard", "sheet2.xml"), ("Countries", "sheet3.xml")]
    items = []
    for i, (name, _) in enumerate(sheets, 1):
        items.append(f'<sheet name="{escape(name)}" sheetId="{i}" r:id="rId{i}"/>')
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>{"".join(items)}</sheets>
</workbook>'''


def content_types():
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>'''


def rels(path_pairs):
    body = "".join(
        f'<Relationship Id="{rid}" Type="{typ}" Target="{target}"/>' for rid, typ, target in path_pairs
    )
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{body}</Relationships>'''


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    files = {
        "[Content_Types].xml": content_types(),
        "_rels/.rels": rels([
            ("rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", "xl/workbook.xml"),
        ]),
        "xl/workbook.xml": workbook(),
        "xl/_rels/workbook.xml.rels": rels([
            ("rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet", "worksheets/sheet1.xml"),
            ("rId2", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet", "worksheets/sheet2.xml"),
            ("rId3", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet", "worksheets/sheet3.xml"),
            ("rId4", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles", "styles.xml"),
        ]),
        "xl/styles.xml": STYLES,
        "xl/worksheets/sheet1.xml": how_to_read(),
        "xl/worksheets/sheet2.xml": scorecard(),
        "xl/worksheets/sheet3.xml": countries(),
    }
    with zipfile.ZipFile(OUT, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for name, text in files.items():
            z.writestr(name, text.encode("utf-8"))
    print("Wrote", OUT)


if __name__ == "__main__":
    main()
