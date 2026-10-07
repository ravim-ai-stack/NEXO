import datetime
from django.utils import timezone
from typing import Any, Dict, List, Optional

from issues.models import ActivityLog, Issue
from projects.models import (
    Project,
    ProjectDoc,
    ProjectIntelligenceSummary,
    ProjectMembership,
    ProjectSignal,
    Sprint,
)


def get_document_freshness(project: Project) -> Dict[str, Any]:
    """Calculates governance and freshness of project documentation."""
    docs = ProjectDoc.objects.filter(project=project).order_by("-updated_at")
    total_docs = docs.count()
    if not total_docs:
        return {
            "total_docs": 0,
            "freshness": "NO_DOCS",
            "last_updated": None,
            "days_since_update": None,
            "label": "No project documents uploaded yet",
        }

    latest = docs.first()
    days_ago = (timezone.now() - latest.updated_at).days

    if days_ago <= 7:
        freshness = "FRESH"
        label = f"Up to date (updated {days_ago}d ago)"
    elif days_ago <= 14:
        freshness = "MODERATE"
        label = f"Moderate (last updated {days_ago}d ago)"
    else:
        freshness = "STALE"
        label = f"Stale (no update in {days_ago} days)"

    return {
        "total_docs": total_docs,
        "freshness": freshness,
        "last_updated": latest.updated_at.isoformat(),
        "days_since_update": days_ago,
        "label": label,
        "latest_doc_title": latest.title,
    }


def compute_deterministic_health(
    total_issues: int,
    done_issues: int,
    critical_issues_count: int,
    overdue_issues_count: int,
    active_sprint: Any,
    doc_blockers_count: int,
    doc_risks_count: int,
    doc_freshness: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Deterministically computes RAG status (ON_TRACK, AT_RISK, OFF_TRACK)
    based on objective project thresholds.
    """
    reasons = []

    # Check for OFF_TRACK conditions
    if doc_blockers_count > 0:
        reasons.append(f"{doc_blockers_count} active critical blocker(s) recorded in project documents")

    if critical_issues_count >= 2:
        reasons.append(f"{critical_issues_count} unresolved critical priority issue(s)")

    if active_sprint and active_sprint.end_date:
        today = timezone.now().date()
        if active_sprint.end_date < today:
            sprint_total = active_sprint.issues.count()
            sprint_done = active_sprint.issues.filter(status="DONE").count()
            sprint_pct = round((sprint_done / sprint_total) * 100) if sprint_total else 0
            if sprint_pct < 80:
                reasons.append(f"Active sprint '{active_sprint.name}' passed end date with only {sprint_pct}% completion")

    if reasons:
        return {
            "status": "OFF_TRACK",
            "badge_color": "#DE350B",
            "label": "Off Track",
            "rationale": " • ".join(reasons),
        }

    # Check for AT_RISK conditions
    risk_reasons = []
    if critical_issues_count == 1:
        risk_reasons.append("1 unresolved critical issue")
    if overdue_issues_count > 0:
        risk_reasons.append(f"{overdue_issues_count} overdue issue(s)")
    if doc_risks_count >= 2:
        risk_reasons.append(f"{doc_risks_count} project risks identified in documentation")
    if doc_freshness.get("freshness") == "STALE":
        risk_reasons.append(f"Documentation stale ({doc_freshness.get('days_since_update')} days without updates)")

    if risk_reasons:
        return {
            "status": "AT_RISK",
            "badge_color": "#FF8B00",
            "label": "At Risk",
            "rationale": " • ".join(risk_reasons),
        }

    # Otherwise ON_TRACK
    return {
        "status": "ON_TRACK",
        "badge_color": "#00875A",
        "label": "On Track",
        "rationale": "Sprints progressing on schedule with zero critical blockers",
    }


def generate_executive_brief(
    project: Project,
    health: Dict[str, Any],
    completion_pct: int,
    total_issues: int,
    done_issues: int,
    in_progress_issues: List[Any],
    current_phase: str,
    active_sprint: Any,
    recent_done: List[Any],
    top_blockers: List[Any],
    top_risks: List[Any],
    upcoming_milestone: Optional[Dict[str, Any]],
    doc_freshness: Dict[str, Any],
) -> str:
    """
    Generates a concise 4-5 bullet executive-friendly briefing
    synthesizing structured database state and document-derived signals.
    """
    bullets = []

    # 1. Project Standing & Pace
    stand_text = f"**Current Standing**: Project is {health['label'].upper()} at **{completion_pct}% completion** ({done_issues} of {total_issues} work items resolved)."
    if current_phase:
        stand_text += f" Currently executing in **{current_phase}**."
    bullets.append(stand_text)

    # 2. Recent Accomplishments
    if recent_done:
        recent_titles = [f"'{i.title}'" for i in recent_done[:2]]
        bullets.append(f"**Recent Accomplishments**: Delivered {len(recent_done)} key task(s) recently, including {', '.join(recent_titles)}.")
    elif done_issues > 0:
        bullets.append(f"**Recent Accomplishments**: {done_issues} work items successfully completed.")
    else:
        bullets.append("**Recent Accomplishments**: Initial setup and requirements gathering completed.")

    # 3. Active Focus
    if active_sprint:
        goal_text = f" - Goal: {active_sprint.goal}" if active_sprint.goal else ""
        bullets.append(f"**Active Focus**: Team is delivering active sprint **'{active_sprint.name}'**{goal_text}, with {len(in_progress_issues)} task(s) actively in development.")
    elif in_progress_issues:
        active_sample = [f"'{i.title}'" for i in in_progress_issues[:2]]
        bullets.append(f"**Active Focus**: Team is advancing {len(in_progress_issues)} in-progress item(s), including {', '.join(active_sample)}.")
    else:
        bullets.append("**Active Focus**: Backlog grooming and task allocation in progress.")

    # 4. Critical Challenges & Risks
    if top_blockers:
        b = top_blockers[0]
        src_note = f" (Source: {b.source_doc.title}, {b.source_location})" if (b.source_doc and b.source_location) else (f" (Source: {b.source_doc.title})" if b.source_doc else "")
        bullets.append(f"**Attention Required**: Critical Blocker: {b.title}{src_note}.")
    elif top_risks:
        r = top_risks[0]
        src_note = f" (Source: {r.source_doc.title})" if r.source_doc else ""
        bullets.append(f"**Identified Risk**: {r.title}{src_note}. Mitigation should be prioritized.")
    elif health["status"] == "AT_RISK":
        bullets.append(f"**Attention Required**: {health['rationale']}.")
    else:
        bullets.append("**Challenges & Blockers**: No critical impediments or blockers currently reported.")

    # 5. Upcoming Milestones & Horizon
    if upcoming_milestone:
        days_str = f" in {upcoming_milestone['days_away']} days" if upcoming_milestone.get("days_away") is not None else ""
        date_str = f" ({upcoming_milestone['target_date']})" if upcoming_milestone.get("target_date") else ""
        bullets.append(f"**Upcoming Horizon**: Next major milestone is **'{upcoming_milestone['title']}'** targeted for{date_str}{days_str}.")
    elif active_sprint and active_sprint.end_date:
        bullets.append(f"**Upcoming Horizon**: Sprint delivery cycle wraps on {active_sprint.end_date.strftime('%b %d, %Y')}.")
    else:
        bullets.append("**Upcoming Horizon**: Next iteration planning in queue.")

    return "\n\n".join(bullets)


def call_llm_if_available(context_summary: str, default_brief: str) -> str:
    """
    Optional LLM generation:
    If GEMINI_API_KEY or OPENAI_API_KEY is configured in backend/.env,
    calls Google Gemini or OpenAI to produce an executive synthesis narrative.
    If no key is configured or if the request times out/fails, gracefully
    returns the deterministic brief.
    """
    import json
    import os
    import urllib.request
    import urllib.error

    gemini_key = os.getenv("GEMINI_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")

    if not gemini_key and not openai_key:
        return default_brief

    system_prompt = (
        "You are an executive PMO AI assistant for the NEXO Project Management Platform. "
        "Summarize the project status in 4-5 concise, impactful bullet points for executive stakeholders. "
        "Focus on: 1) Standing & Completion pace, 2) Recent Accomplishments, 3) Current Workstream & Sprint Focus, "
        "4) Critical Blockers & Risks (with source attribution), and 5) Upcoming Milestones & Horizon. "
        "Be direct, executive-level, and accurate to the provided data. Do not hallucinate metrics."
    )

    # 1. Try Google Gemini if key provided
    if gemini_key:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={gemini_key}"
            payload = {
                "contents": [
                    {
                        "parts": [
                            {"text": f"{system_prompt}\n\nProject Data:\n{context_summary}"}
                        ]
                    }
                ],
                "generationConfig": {"temperature": 0.2, "maxOutputTokens": 600},
            }
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=6) as response:
                res_data = json.loads(response.read().decode("utf-8"))
                candidates = res_data.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    if parts and parts[0].get("text"):
                        return parts[0]["text"].strip()
        except Exception as e:
            print(f"[Gemini LLM optional call skipped]: {e}")

    # 2. Try OpenAI if key provided
    if openai_key:
        try:
            url = "https://api.openai.com/v1/chat/completions"
            payload = {
                "model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Project Data:\n{context_summary}"},
                ],
                "temperature": 0.2,
                "max_tokens": 600,
            }
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {openai_key}",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=6) as response:
                res_data = json.loads(response.read().decode("utf-8"))
                choices = res_data.get("choices", [])
                if choices:
                    content = choices[0].get("message", {}).get("content")
                    if content:
                        return content.strip()
        except Exception as e:
            print(f"[OpenAI LLM optional call skipped]: {e}")

    return default_brief


def generate_project_intelligence(project: Project) -> Dict[str, Any]:
    """
    Main aggregator:
    Combines structured NEXO data (Issues, Sprints, Members, Activity)
    with unstructured signals extracted from ProjectDoc documents (PDF, DOCX, XLSX, Markdown).
    """
    today = timezone.now().date()
    all_issues = Issue.objects.filter(project=project).select_related("assignee", "reporter")
    total_issues = all_issues.count()
    done_issues_qs = all_issues.filter(status="DONE")
    done_count = done_issues_qs.count()
    in_progress_qs = all_issues.filter(status="IN_PROGRESS")
    in_progress_count = in_progress_qs.count()
    todo_count = all_issues.filter(status="TODO").count()

    completion_pct = round((done_count / total_issues) * 100) if total_issues else 0

    # Overdue issues
    overdue_issues_qs = all_issues.filter(due_date__lt=today).exclude(status="DONE")
    overdue_count = overdue_issues_qs.count()

    # Critical issues
    critical_issues_qs = all_issues.filter(priority="CRITICAL").exclude(status="DONE")
    critical_count = critical_issues_qs.count()

    # Active sprint
    active_sprint = Sprint.objects.filter(project=project, status="ACTIVE").first()
    sprint_info = None
    if active_sprint:
        sp_issues = active_sprint.issues.all()
        sp_total = sp_issues.count()
        sp_done = sp_issues.filter(status="DONE").count()
        sp_pct = round((sp_done / sp_total) * 100) if sp_total else 0
        days_left = (active_sprint.end_date - today).days if active_sprint.end_date else None
        sprint_info = {
            "id": active_sprint.id,
            "name": active_sprint.name,
            "goal": active_sprint.goal,
            "start_date": str(active_sprint.start_date) if active_sprint.start_date else None,
            "end_date": str(active_sprint.end_date) if active_sprint.end_date else None,
            "total_issues": sp_total,
            "done_issues": sp_done,
            "percent": sp_pct,
            "days_left": days_left,
        }

    # Document signals
    signals_qs = ProjectSignal.objects.filter(project=project).select_related("source_doc")
    doc_blockers = list(signals_qs.filter(category="BLOCKER", status="ACTIVE"))
    doc_risks = list(signals_qs.filter(category="RISK", status="ACTIVE"))
    doc_challenges = list(signals_qs.filter(category="CHALLENGE", status="ACTIVE"))
    doc_dependencies = list(signals_qs.filter(category="DEPENDENCY", status="ACTIVE"))
    doc_decisions = list(signals_qs.filter(category="DECISION"))[:6]
    doc_updates = list(signals_qs.filter(category="UPDATE"))[:6]
    doc_milestones = list(signals_qs.filter(category="MILESTONE"))
    doc_phases = list(signals_qs.filter(category="PHASE"))
    doc_resource_notes = list(signals_qs.filter(category="RESOURCE_NOTE"))

    doc_freshness = get_document_freshness(project)

    # Health evaluation (RAG)
    health = compute_deterministic_health(
        total_issues=total_issues,
        done_issues=done_count,
        critical_issues_count=critical_count,
        overdue_issues_count=overdue_count,
        active_sprint=active_sprint,
        doc_blockers_count=len(doc_blockers),
        doc_risks_count=len(doc_risks),
        doc_freshness=doc_freshness,
    )

    # Current Phase determination
    current_phase = "Active Development"
    if active_sprint:
        current_phase = f"Sprint: {active_sprint.name}"
    elif doc_phases:
        active_p = next((p for p in doc_phases if p.status == "ACTIVE"), doc_phases[0])
        current_phase = active_p.title

    # Workstream breakdown (by issue type & workflow state)
    workstream_breakdown = []
    for t in ["EPIC", "STORY", "TASK", "BUG"]:
        t_issues = all_issues.filter(issue_type=t)
        if t_issues.exists():
            c_done = t_issues.filter(status="DONE").count()
            c_tot = t_issues.count()
            workstream_breakdown.append({
                "type": t,
                "total": c_tot,
                "done": c_done,
                "in_progress": t_issues.filter(status="IN_PROGRESS").count(),
                "todo": t_issues.filter(status="TODO").count(),
                "percent": round((c_done / c_tot) * 100) if c_tot else 0,
            })

    # Milestones & Timeline
    timeline_items = []
    # 1. Add active sprint milestone
    if active_sprint and active_sprint.end_date:
        days_diff = (active_sprint.end_date - today).days
        timeline_items.append({
            "title": f"Sprint End: {active_sprint.name}",
            "type": "SPRINT",
            "target_date": str(active_sprint.end_date),
            "status": "COMPLETED" if days_diff < 0 and sprint_info["percent"] >= 100 else ("DELAYED" if days_diff < 0 else "ACTIVE"),
            "days_away": days_diff,
            "source": "Active Sprint",
            "source_location": f"Sprint {active_sprint.name}",
        })

    # 2. Add document-derived milestones
    for m in doc_milestones:
        days_diff = (m.target_date - today).days if m.target_date else None
        timeline_items.append({
            "title": m.title,
            "type": "DOCUMENT_MILESTONE",
            "target_date": str(m.target_date) if m.target_date else None,
            "status": m.status or "ACTIVE",
            "days_away": days_diff,
            "source": m.source_doc.title if m.source_doc else "Project Document",
            "source_location": m.source_location or "Plan",
        })

    # 3. Add issues with explicit due dates
    for i in all_issues.filter(due_date__isnull=False).order_by("due_date")[:5]:
        days_diff = (i.due_date - today).days
        timeline_items.append({
            "title": f"[{project.key}-{i.id}] {i.title}",
            "type": "ISSUE_DUE",
            "target_date": str(i.due_date),
            "status": "COMPLETED" if i.status == "DONE" else ("DELAYED" if days_diff < 0 else "ACTIVE"),
            "days_away": days_diff,
            "source": f"Issue {project.key}-{i.id}",
            "source_location": f"Due Date: {i.due_date}",
        })

    # Find upcoming milestone
    future_milestones = [m for m in timeline_items if m.get("days_away") is not None and m["days_away"] >= 0 and m["status"] != "COMPLETED"]
    future_milestones.sort(key=lambda x: x["days_away"])
    upcoming_milestone = future_milestones[0] if future_milestones else None

    # Team resource workload
    memberships = ProjectMembership.objects.filter(project=project).select_related("user")
    team_members = []
    unassigned_count = all_issues.filter(assignee__isnull=True).count()

    for m in memberships:
        u = m.user
        u_issues = all_issues.filter(assignee=u)
        u_done = u_issues.filter(status="DONE").count()
        u_active = u_issues.filter(status="IN_PROGRESS").count()
        u_todo = u_issues.filter(status="TODO").count()
        u_tot = u_issues.count()
        u_pct = round((u_done / u_tot) * 100) if u_tot else 0

        team_members.append({
            "id": u.id,
            "username": u.username,
            "avatar_url": u.avatar_url,
            "role": m.role,
            "total_assigned": u_tot,
            "active_count": u_active,
            "done_count": u_done,
            "todo_count": u_todo,
            "completion_pct": u_pct,
        })

    # Challenges / Risks / Blockers consolidated
    consolidated_risks = []
    # 1. Critical issue blockers
    for i in critical_issues_qs:
        consolidated_risks.append({
            "type": "BLOCKER",
            "title": f"Critical Issue: [{project.key}-{i.id}] {i.title}",
            "description": i.description[:200] if i.description else "Critical priority work item requires urgent attention.",
            "severity": "CRITICAL",
            "source_type": "TICKET",
            "source_title": f"Issue {project.key}-{i.id}",
            "source_location": f"Status: {i.status}",
            "confidence": 1.0,
        })

    # 2. Overdue issues
    for i in overdue_issues_qs:
        consolidated_risks.append({
            "type": "CHALLENGE",
            "title": f"Overdue: [{project.key}-{i.id}] {i.title}",
            "description": f"Target due date was {i.due_date}. Currently in {i.status}.",
            "severity": "HIGH",
            "source_type": "TICKET",
            "source_title": f"Issue {project.key}-{i.id}",
            "source_location": f"Due: {i.due_date}",
            "confidence": 1.0,
        })

    # 3. Document-extracted blockers
    for b in doc_blockers:
        consolidated_risks.append({
            "type": "BLOCKER",
            "title": b.title,
            "description": b.description,
            "severity": "CRITICAL",
            "source_type": "DOCUMENT",
            "source_title": b.source_doc.title if b.source_doc else "Project Document",
            "source_location": b.source_location or "Status Report",
            "confidence": b.confidence,
        })

    # 4. Document-extracted risks
    for r in doc_risks:
        consolidated_risks.append({
            "type": "RISK",
            "title": r.title,
            "description": r.description,
            "severity": r.severity,
            "source_type": "DOCUMENT",
            "source_title": r.source_doc.title if r.source_doc else "Project Document",
            "source_location": r.source_location or "Risk Register",
            "confidence": r.confidence,
        })

    # 5. Document-extracted dependencies
    for d in doc_dependencies:
        consolidated_risks.append({
            "type": "DEPENDENCY",
            "title": d.title,
            "description": d.description,
            "severity": d.severity,
            "source_type": "DOCUMENT",
            "source_title": d.source_doc.title if d.source_doc else "Project Document",
            "source_location": d.source_location or "Architecture / Design",
            "confidence": d.confidence,
        })

    # Recent updates consolidated
    recent_done_issues = list(done_issues_qs.order_by("-updated_at")[:5])
    recent_activity_logs = list(
        ActivityLog.objects.filter(issue__project=project).select_related("actor", "issue").order_by("-created_at")[:8]
    )

    # Generate Executive AI Brief
    deterministic_brief = generate_executive_brief(
        project=project,
        health=health,
        completion_pct=completion_pct,
        total_issues=total_issues,
        done_issues=done_count,
        in_progress_issues=list(in_progress_qs[:5]),
        current_phase=current_phase,
        active_sprint=active_sprint,
        recent_done=recent_done_issues,
        top_blockers=doc_blockers,
        top_risks=doc_risks,
        upcoming_milestone=upcoming_milestone,
        doc_freshness=doc_freshness,
    )

    # Optional LLM polish if GEMINI_API_KEY or OPENAI_API_KEY is configured
    blockers_preview = ", ".join([b.title for b in doc_blockers[:3]]) or "None"
    risks_preview = ", ".join([r.title for r in doc_risks[:3]]) or "None"
    next_ms_preview = f"{upcoming_milestone['title']} (in {upcoming_milestone.get('days_away')}d)" if upcoming_milestone else "None"
    context_summary = (
        f"Project: {project.name} ({project.key})\n"
        f"Status: {health['status']} - {health['label']}\n"
        f"Rationale: {health['rationale']}\n"
        f"Current Phase: {current_phase}\n"
        f"Completion: {completion_pct}% ({done_count} of {total_issues} tasks done)\n"
        f"Active Sprint: {active_sprint.name if active_sprint else 'None'}\n"
        f"Active Blockers: {blockers_preview}\n"
        f"Identified Risks: {risks_preview}\n"
        f"Next Milestone: {next_ms_preview}\n"
    )
    executive_brief = call_llm_if_available(context_summary, deterministic_brief)

    # Persist or update ProjectIntelligenceSummary cache
    summary_obj, _ = ProjectIntelligenceSummary.objects.update_or_create(
        project=project,
        defaults={
            "health_status": health["status"],
            "health_rationale": health["rationale"],
            "current_phase": current_phase,
            "executive_summary": executive_brief,
            "signals_count": signals_qs.count(),
        },
    )

    # Recent docs list for quick access
    recent_docs_list = []
    for d in ProjectDoc.objects.filter(project=project).order_by("-updated_at")[:6]:
        recent_docs_list.append({
            "id": d.id,
            "title": d.title,
            "template_type": d.template_type,
            "template_label": d.get_template_type_display(),
            "file_type": d.file_type,
            "file_size": d.file_size,
            "has_file": bool(d.file),
            "updated_at": d.updated_at.isoformat(),
            "signals_count": d.signals.count(),
        })

    return {
        "project": {
            "id": project.id,
            "name": project.name,
            "key": project.key,
            "description": project.description,
            "created_by": project.created_by.username if project.created_by else "Admin",
            "created_at": project.created_at.isoformat(),
        },
        "health": health,
        "current_phase": current_phase,
        "executive_summary": executive_brief,
        "completion_percent": completion_pct,
        "signals_count": signals_qs.count(),
        "progress_metrics": {
            "total_issues": total_issues,
            "done_issues": done_count,
            "in_progress_issues": in_progress_count,
            "todo_issues": todo_count,
            "overdue_issues": overdue_count,
            "critical_issues": critical_count,
        },
        "active_sprint": sprint_info,
        "workstreams": workstream_breakdown,
        "timeline": {
            "milestones": timeline_items,
            "upcoming_milestone": upcoming_milestone,
            "has_delays": any(m.get("status") == "DELAYED" for m in timeline_items),
        },
        "team_resources": {
            "members": team_members,
            "unassigned_count": unassigned_count,
            "notes": [n.title for n in doc_resource_notes],
        },
        "challenges_and_risks": consolidated_risks,
        "recent_updates": {
            "completed_work": [
                {"id": i.id, "title": i.title, "key": f"{project.key}-{i.id}", "updated_at": i.updated_at.isoformat()}
                for i in recent_done_issues
            ],
            "decisions": [
                {"title": d.title, "source": d.source_doc.title if d.source_doc else "Meeting Notes", "location": d.source_location}
                for d in doc_decisions
            ],
            "activity_feed": [
                {
                    "id": a.id,
                    "actor": a.actor.username if a.actor else "System",
                    "field_changed": a.field_changed,
                    "old_value": a.old_value,
                    "new_value": a.new_value,
                    "issue_id": a.issue.id,
                    "issue_title": a.issue.title,
                    "project_key": project.key,
                    "created_at": a.created_at.isoformat(),
                }
                for a in recent_activity_logs
            ],
        },
        "documentation_governance": doc_freshness,
        "recent_documents": recent_docs_list,
        "last_synced_at": summary_obj.last_synced_at.isoformat(),
    }
