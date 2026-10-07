import re
from typing import Tuple


def classify_document(title: str, text: str) -> Tuple[str, float]:
    """
    Classifies a project document into one of the canonical ProjectDoc.TemplateType categories:
    - STATUS: Status / Weekly Report
    - TIMELINE: Timeline & Project Plan / Milestones
    - RESOURCE: Resource / Team document
    - PRD: Product Requirements Document
    - ARCHITECTURE: Architecture & System Design
    - RETRO: Sprint Retrospective
    - MEETING: Meeting Notes & Decisions
    - CUSTOM: Fallback Custom Document

    Returns (category_code, confidence).
    """
    combined = f"{title}\n{text}".lower()

    scores = {
        "STATUS": 0,
        "TIMELINE": 0,
        "RESOURCE": 0,
        "PRD": 0,
        "ARCHITECTURE": 0,
        "RETRO": 0,
        "MEETING": 0,
    }

    # 1. STATUS keywords
    status_keywords = [
        "weekly report", "status report", "progress update", "project status",
        "accomplishments", "what we did this week", "next week focus", "weekly status",
        "work in progress", "current highlights", "project pulse"
    ]
    for kw in status_keywords:
        if kw in combined:
            scores["STATUS"] += 3

    # 2. TIMELINE keywords
    timeline_keywords = [
        "timeline", "project plan", "milestones", "gantt", "work breakdown", "schedule",
        "target date", "completion date", "phases", "delivery schedule", "phase 1", "phase 2",
        "sprint plan", "release date", "roadmap"
    ]
    for kw in timeline_keywords:
        if kw in combined:
            scores["TIMELINE"] += 3

    # 3. RESOURCE keywords
    resource_keywords = [
        "resource allocation", "team allocation", "headcount", "staffing",
        "fte", "resource plan", "developer allocation", "bandwidth", "responsibilities"
    ]
    for kw in resource_keywords:
        if kw in combined:
            scores["RESOURCE"] += 3

    # 4. PRD keywords
    prd_keywords = [
        "product requirement", "prd", "user stories", "functional requirement",
        "acceptance criteria", "user persona", "scope and out of scope", "business goal"
    ]
    for kw in prd_keywords:
        if kw in combined:
            scores["PRD"] += 3

    # 5. ARCHITECTURE keywords
    arch_keywords = [
        "architecture", "system design", "component diagram", "tech stack",
        "database schema", "api contract", "service boundary", "microservice",
        "infrastructure", "technical dependency"
    ]
    for kw in arch_keywords:
        if kw in combined:
            scores["ARCHITECTURE"] += 3

    # 6. RETRO keywords
    retro_keywords = [
        "retrospective", "sprint retro", "what went well", "what could be improved",
        "action items", "start doing", "stop doing", "team feedback"
    ]
    for kw in retro_keywords:
        if kw in combined:
            scores["RETRO"] += 3

    # 7. MEETING keywords
    meeting_keywords = [
        "meeting notes", "meeting minutes", "attendees", "agenda",
        "decisions made", "standup notes", "sync meeting", "discussion points"
    ]
    for kw in meeting_keywords:
        if kw in combined:
            scores["MEETING"] += 3

    # Title-specific boosts
    title_lower = title.lower()
    if any(k in title_lower for k in ["status", "weekly", "update"]):
        scores["STATUS"] += 5
    if any(k in title_lower for k in ["timeline", "plan", "milestone", "schedule"]):
        scores["TIMELINE"] += 5
    if any(k in title_lower for k in ["resource", "team", "allocation"]):
        scores["RESOURCE"] += 5
    if any(k in title_lower for k in ["prd", "requirement"]):
        scores["PRD"] += 5
    if any(k in title_lower for k in ["arch", "design", "system"]):
        scores["ARCHITECTURE"] += 5
    if any(k in title_lower for k in ["retro", "retrospective"]):
        scores["RETRO"] += 5
    if any(k in title_lower for k in ["meeting", "minutes", "standup"]):
        scores["MEETING"] += 5

    best_cat = max(scores, key=scores.get)
    best_score = scores[best_cat]

    if best_score >= 4:
        confidence = min(0.95, 0.6 + (best_score * 0.05))
        return best_cat, confidence
    return "CUSTOM", 0.5
