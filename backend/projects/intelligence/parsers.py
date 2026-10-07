import io
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class DocumentSection:
    heading: str
    content: str
    location: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ParsedDocument:
    raw_text: str
    file_type: str
    sections: List[DocumentSection] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)


def parse_markdown_text(text: str, source_name: str = "Document") -> ParsedDocument:
    """Parses markdown text by identifying headings, lists, and sections."""
    lines = text.splitlines()
    sections: List[DocumentSection] = []
    current_heading = "Overview"
    current_lines = []
    section_index = 1

    for line in lines:
        heading_match = re.match(r"^(#{1,4})\s+(.+)$", line.strip())
        if heading_match:
            if current_lines:
                sections.append(
                    DocumentSection(
                        heading=current_heading,
                        content="\n".join(current_lines).strip(),
                        location=f"Section: {current_heading}",
                    )
                )
                current_lines = []
            current_heading = heading_match.group(2).strip()
            section_index += 1
        else:
            current_lines.append(line)

    if current_lines:
        sections.append(
            DocumentSection(
                heading=current_heading,
                content="\n".join(current_lines).strip(),
                location=f"Section: {current_heading}",
            )
        )

    return ParsedDocument(
        raw_text=text,
        file_type="MARKDOWN",
        sections=sections,
        metadata={"source": source_name, "section_count": len(sections)},
    )


def parse_xlsx(file_content: bytes, filename: str) -> ParsedDocument:
    """Parses Excel spreadsheets (XLSX) extracting sheets, rows, and structured cells."""
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(file_content), data_only=True)
    sections: List[DocumentSection] = []
    full_text_lines = []

    for sheet_name in wb.sheetnames:
        sheet = wb[sheet_name]
        sheet_rows = []
        for r_idx, row in enumerate(sheet.iter_rows(values_only=True), start=1):
            # Filter empty rows
            non_empty = [str(val).strip() for val in row if val is not None and str(val).strip()]
            if not non_empty:
                continue
            row_str = " | ".join(non_empty)
            sheet_rows.append((r_idx, row_str, non_empty))
            full_text_lines.append(f"[{sheet_name} Row {r_idx}] {row_str}")

        if sheet_rows:
            content = "\n".join(f"[Row {r[0]}] {r[1]}" for r in sheet_rows)
            sections.append(
                DocumentSection(
                    heading=f"Sheet: {sheet_name}",
                    content=content,
                    location=f"Sheet: {sheet_name}",
                    metadata={"sheet_name": sheet_name, "rows_count": len(sheet_rows)},
                )
            )

    return ParsedDocument(
        raw_text="\n".join(full_text_lines),
        file_type="XLSX",
        sections=sections,
        metadata={"filename": filename, "sheets": wb.sheetnames},
    )


def parse_docx(file_content: bytes, filename: str) -> ParsedDocument:
    """Parses Word documents (DOCX) extracting paragraphs, headings, and tables."""
    import docx

    doc = docx.Document(io.BytesIO(file_content))
    sections: List[DocumentSection] = []
    current_heading = "Overview"
    current_lines = []
    full_text_lines = []

    for p in doc.paragraphs:
        text = p.text.strip()
        if not text:
            continue
        full_text_lines.append(text)
        if p.style.name.startswith("Heading"):
            if current_lines:
                sections.append(
                    DocumentSection(
                        heading=current_heading,
                        content="\n".join(current_lines),
                        location=f"Heading: {current_heading}",
                    )
                )
                current_lines = []
            current_heading = text
        else:
            current_lines.append(text)

    # Also parse tables
    table_index = 1
    for table in doc.tables:
        table_rows = []
        for r_idx, row in enumerate(table.rows, start=1):
            cells = [c.text.strip() for c in row.cells if c.text.strip()]
            if cells:
                # Deduplicate repeated cells if cells span columns
                deduped = []
                for c in cells:
                    if not deduped or c != deduped[-1]:
                        deduped.append(c)
                table_rows.append(f"[Row {r_idx}] " + " | ".join(deduped))
        if table_rows:
            t_content = "\n".join(table_rows)
            full_text_lines.append(t_content)
            sections.append(
                DocumentSection(
                    heading=f"Table {table_index}",
                    content=t_content,
                    location=f"Table {table_index}",
                )
            )
            table_index += 1

    if current_lines:
        sections.append(
            DocumentSection(
                heading=current_heading,
                content="\n".join(current_lines),
                location=f"Heading: {current_heading}",
            )
        )

    return ParsedDocument(
        raw_text="\n".join(full_text_lines),
        file_type="DOCX",
        sections=sections,
        metadata={"filename": filename},
    )


def parse_pdf(file_content: bytes, filename: str) -> ParsedDocument:
    """Parses PDF files extracting text per page for precise source location."""
    import pypdf

    reader = pypdf.PdfReader(io.BytesIO(file_content))
    sections: List[DocumentSection] = []
    full_text_lines = []

    for idx, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        text = text.strip()
        if text:
            full_text_lines.append(f"--- Page {idx} ---\n{text}")
            sections.append(
                DocumentSection(
                    heading=f"Page {idx}",
                    content=text,
                    location=f"Page {idx}",
                    metadata={"page": idx},
                )
            )

    return ParsedDocument(
        raw_text="\n".join(full_text_lines),
        file_type="PDF",
        sections=sections,
        metadata={"filename": filename, "total_pages": len(reader.pages)},
    )


def parse_uploaded_file(file_obj, filename: str = "") -> ParsedDocument:
    """Entrypoint to parse uploaded file or text."""
    name = (filename or getattr(file_obj, "name", "") or "").lower()

    if hasattr(file_obj, "read"):
        content_bytes = file_obj.read()
        if hasattr(file_obj, "seek"):
            file_obj.seek(0)
    elif isinstance(file_obj, bytes):
        content_bytes = file_obj
    else:
        # String content
        return parse_markdown_text(str(file_obj), source_name=filename or "Document")

    if name.endswith(".xlsx") or name.endswith(".xls"):
        return parse_xlsx(content_bytes, filename)
    elif name.endswith(".docx"):
        return parse_docx(content_bytes, filename)
    elif name.endswith(".pdf"):
        return parse_pdf(content_bytes, filename)
    else:
        try:
            text = content_bytes.decode("utf-8")
        except UnicodeDecodeError:
            text = content_bytes.decode("latin-1", errors="ignore")
        return parse_markdown_text(text, source_name=filename)
