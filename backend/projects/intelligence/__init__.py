from typing import Any, Dict
from django.db import transaction

from projects.models import Project, ProjectDoc, ProjectSignal
from .classifier import classify_document
from .extractors import extract_signals_from_parsed_doc
from .parsers import parse_uploaded_file
from .synthesizer import generate_project_intelligence


def process_and_extract_document(doc: ProjectDoc) -> Dict[str, Any]:
    """
    End-to-end document processing pipeline:
    1. Parse file or markdown text content
    2. Understand & classify document type if needed
    3. Extract context-aware project signals (Risks, Blockers, Milestones, Decisions, Updates)
    4. Save normalized ProjectSignal records with source traceability
    5. Update project intelligence summary
    """
    file_obj = doc.file if doc.file else doc.content
    filename = doc.file.name if doc.file else f"{doc.title}.md"

    # Step 1: Parse
    parsed = parse_uploaded_file(file_obj, filename=filename)

    # Step 2: Classify if CUSTOM or ambiguous
    if doc.template_type == ProjectDoc.TemplateType.CUSTOM or not doc.template_type:
        detected_type, conf = classify_document(doc.title, parsed.raw_text)
        if conf >= 0.7:
            doc.template_type = detected_type

    # Update doc metadata
    doc.raw_text = parsed.raw_text[:50000]  # Store first 50k chars of parsed text
    doc.file_type = parsed.file_type
    if doc.file:
        try:
            doc.file_size = doc.file.size
        except Exception:
            pass
    doc.save(update_fields=["template_type", "raw_text", "file_type", "file_size"])

    # Step 3 & 4: Extract and Save Signals in transaction
    raw_signals = extract_signals_from_parsed_doc(
        parsed=parsed, doc_type=doc.template_type, doc_title=doc.title
    )

    with transaction.atomic():
        # Remove previously extracted signals from this document to avoid duplicates
        ProjectSignal.objects.filter(source_doc=doc).delete()

        created_signals = []
        for s in raw_signals:
            created_signals.append(
                ProjectSignal(
                    project=doc.project,
                    source_doc=doc,
                    category=s["category"],
                    title=s["title"],
                    description=s.get("description", ""),
                    status=s.get("status", "ACTIVE"),
                    severity=s.get("severity", "MEDIUM"),
                    target_date=s.get("target_date"),
                    source_location=s.get("source_location", doc.title),
                    confidence=s.get("confidence", 0.85),
                )
            )
        if created_signals:
            ProjectSignal.objects.bulk_create(created_signals)

    # Step 5: Update project intelligence summary
    intelligence_payload = generate_project_intelligence(doc.project)
    return intelligence_payload
