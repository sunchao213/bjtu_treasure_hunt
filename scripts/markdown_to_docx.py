from __future__ import annotations

import re
import sys
from pathlib import Path

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


BLUE = "1F4E78"
LIGHT_BLUE = "D9EAF7"
LIGHT_GRAY = "F2F4F7"
BORDER = "D9D9D9"


def set_font(run, name="等线", size=10.5, bold=False, color="000000"):
    run.font.name = name
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), name)
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), name)
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), name)
    run.font.size = Pt(size)
    run.bold = bold
    run.font.color.rgb = RGBColor.from_string(color)


def shade(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def borders(table, color=BORDER, size="4"):
    tbl_pr = table._tbl.tblPr
    tbl_borders = tbl_pr.first_child_found_in("w:tblBorders")
    if tbl_borders is None:
        tbl_borders = OxmlElement("w:tblBorders")
        tbl_pr.append(tbl_borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = "w:" + edge
        element = tbl_borders.find(qn(tag))
        if element is None:
            element = OxmlElement(tag)
            tbl_borders.append(element)
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), size)
        element.set(qn("w:space"), "0")
        element.set(qn("w:color"), color)


def set_cell_text(cell, text, header=False, table_font=8.5):
    cell.text = ""
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.line_spacing = 1.05
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    for part in re.split(r"(`[^`]+`|\*\*[^*]+\*\*)", text):
        if not part:
            continue
        run = p.add_run(part.replace("**", "").replace("`", ""))
        set_font(run, size=table_font, bold=header or part.startswith("**"), color="FFFFFF" if header else "000000")
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    shade(cell, BLUE if header else "FFFFFF")


def add_inline_paragraph(doc, text, style=None):
    p = doc.add_paragraph(style=style)
    p.paragraph_format.space_after = Pt(5)
    p.paragraph_format.line_spacing = 1.12
    pieces = re.split(r"(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)", text)
    for piece in pieces:
        if not piece:
            continue
        bold = piece.startswith("**") and piece.endswith("**")
        italic = piece.startswith("*") and piece.endswith("*") and not bold
        clean = piece[2:-2] if bold else piece[1:-1] if italic else piece.replace("`", "")
        run = p.add_run(clean)
        set_font(run, size=10.5, bold=bold)
        run.italic = italic
    return p


def add_table(doc, rows, landscape=False):
    if not rows:
        return
    table = doc.add_table(rows=len(rows), cols=len(rows[0]))
    table.autofit = True
    table.style = "Table Grid"
    borders(table)
    for r, row in enumerate(rows):
        for c, value in enumerate(row):
            set_cell_text(table.cell(r, c), value, header=r == 0, table_font=8.2 if len(row) >= 5 else 8.8)
    # Repeat the header row when the table spans pages.
    tr_pr = table.rows[0]._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)
    for r, row in enumerate(table.rows[1:], start=1):
        if r % 2 == 0:
            for cell in row.cells:
                shade(cell, LIGHT_GRAY)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def parse_table(lines, start):
    rows = []
    i = start
    while i < len(lines) and lines[i].strip().startswith("|"):
        parts = [p.strip() for p in lines[i].strip().strip("|").split("|")]
        if rows and all(re.fullmatch(r":?-{3,}:?", part.replace(" ", "")) for part in parts):
            i += 1
            continue
        rows.append(parts)
        i += 1
    width = max(len(row) for row in rows)
    rows = [row + [""] * (width - len(row)) for row in rows]
    return rows, i


def configure_document(doc, landscape=False):
    section = doc.sections[0]
    section.top_margin = Inches(0.65)
    section.bottom_margin = Inches(0.65)
    section.left_margin = Inches(0.7)
    section.right_margin = Inches(0.7)
    if landscape:
        section.orientation = WD_ORIENT.LANDSCAPE
        section.page_width, section.page_height = section.page_height, section.page_width
    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = "等线"
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), "等线")
    normal.font.size = Pt(10.5)
    for style_name, size, color in (("Title", 20, "000000"), ("Heading 1", 15, "000000"), ("Heading 2", 12.5, "000000"), ("Heading 3", 11, "000000")):
        style = styles[style_name]
        style.font.name = "等线"
        style._element.rPr.rFonts.set(qn("w:eastAsia"), "等线")
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = RGBColor.from_string(color)


def convert(src: Path, dest: Path):
    text = src.read_text(encoding="utf-8")
    lines = text.splitlines()
    doc = Document()
    configure_document(doc, landscape=src.stem in {"b-module-requirements", "b-acceptance-cases"})
    i = 0
    code = False
    code_lines = []
    first_heading = True
    while i < len(lines):
        line = lines[i]
        if line.strip().startswith("```"):
            if code:
                p = doc.add_paragraph()
                p.paragraph_format.left_indent = Inches(0.25)
                p.paragraph_format.space_after = Pt(6)
                for code_line in code_lines:
                    run = p.add_run(code_line + "\n")
                    set_font(run, name="Consolas", size=8.5)
                code = False
                code_lines = []
            else:
                code = True
            i += 1
            continue
        if code:
            code_lines.append(line)
            i += 1
            continue
        if not line.strip():
            i += 1
            continue
        heading = re.match(r"^(#{1,3})\s+(.*)$", line)
        if heading:
            level = len(heading.group(1))
            title = re.sub(r"[`*_]", "", heading.group(2)).strip()
            if level == 1 and first_heading:
                p = doc.add_paragraph(style="Title")
                p.paragraph_format.space_after = Pt(10)
                run = p.add_run(title)
                set_font(run, size=20, bold=True)
                first_heading = False
            else:
                p = doc.add_paragraph(style=f"Heading {level}")
                p.paragraph_format.space_before = Pt(9 if level == 1 else 6)
                p.paragraph_format.space_after = Pt(4)
                run = p.add_run(title)
                set_font(run, size=15 if level == 1 else 12.5 if level == 2 else 11, bold=True)
            i += 1
            continue
        if line.strip().startswith("|") and i + 1 < len(lines):
            rows, i = parse_table(lines, i)
            add_table(doc, rows)
            continue
        bullet = re.match(r"^\s*[-*]\s+(.*)$", line)
        numbered = re.match(r"^\s*\d+\.\s+(.*)$", line)
        if bullet or numbered:
            content = bullet.group(1) if bullet else numbered.group(1)
            p = add_inline_paragraph(doc, content, style="List Bullet" if bullet else "List Number")
            p.paragraph_format.left_indent = Inches(0.25)
            i += 1
            continue
        if re.match(r"^\s*[-*]\s+\[[ xX]\]\s+", line):
            content = re.sub(r"^\s*[-*]\s+\[[ xX]\]\s+", "☐ ", line)
            add_inline_paragraph(doc, content)
            i += 1
            continue
        if line.strip().startswith(">"):
            add_inline_paragraph(doc, line.strip()[1:].strip())
            i += 1
            continue
        add_inline_paragraph(doc, line)
        i += 1
    if code_lines:
        p = doc.add_paragraph()
        for code_line in code_lines:
            run = p.add_run(code_line + "\n")
            set_font(run, name="Consolas", size=8.5)
    dest.parent.mkdir(parents=True, exist_ok=True)
    doc.save(dest)


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: markdown_to_docx.py <source-dir> <destination-dir>")
    src_dir = Path(sys.argv[1])
    dest_dir = Path(sys.argv[2])
    names = {
        "b-module-requirements": "B模块需求与数据字典",
        "b-design": "B概要设计与详细设计",
        "b-acceptance-cases": "B模块验收用例初稿",
        "b-change-log": "B模块修改记录与已知问题",
        "b-submission-checklist": "B交付与合稿核对表",
    }
    for source_name, output_name in names.items():
        convert(src_dir / f"{source_name}.md", dest_dir / f"{output_name}.docx")


if __name__ == "__main__":
    main()
