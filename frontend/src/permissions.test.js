/**
 * NEXO — Permission System Unit Tests
 * Run with: npx vitest --run
 *
 * Roles: ADMIN (everything), MANAGER (everything except deleting projects),
 * MEMBER (read-only except status + resolution), VIEWER (read-only).
 */

import { describe, it, expect } from "vitest";
import { can, canAny, getPermissions, ACTIONS } from "./permissions";

const ALL_ACTIONS = Object.values(ACTIONS);

describe("ADMIN — full access", () => {
  it.each(ALL_ACTIONS)("can %s", (action) => expect(can("ADMIN", action)).toBe(true));
});

describe("MANAGER — everything except deleting projects and tasks", () => {
  const denied = [ACTIONS.DELETE_PROJECT, ACTIONS.DELETE_ISSUE];
  it.each(ALL_ACTIONS.filter((a) => !denied.includes(a)))("can %s", (action) =>
    expect(can("MANAGER", action)).toBe(true)
  );
  it("can create and edit tasks", () => {
    expect(can("MANAGER", ACTIONS.CREATE_ISSUE)).toBe(true);
    expect(can("MANAGER", ACTIONS.EDIT_ISSUE)).toBe(true);
  });
  it("cannot delete_issue", () => expect(can("MANAGER", ACTIONS.DELETE_ISSUE)).toBe(false));
  it("can create_project", () => expect(can("MANAGER", ACTIONS.CREATE_PROJECT)).toBe(true));
  it("cannot delete_project", () => expect(can("MANAGER", ACTIONS.DELETE_PROJECT)).toBe(false));
});

describe("MEMBER — read-only except status and resolution", () => {
  const allowed = [ACTIONS.CHANGE_ISSUE_STATUS, ACTIONS.CHANGE_RESOLUTION];
  it.each(allowed)("can %s", (action) => expect(can("MEMBER", action)).toBe(true));
  it.each(ALL_ACTIONS.filter((a) => !allowed.includes(a)))("cannot %s", (action) =>
    expect(can("MEMBER", action)).toBe(false)
  );
  it("cannot create issues, projects, sprints or comments", () => {
    for (const a of [ACTIONS.CREATE_ISSUE, ACTIONS.CREATE_PROJECT, ACTIONS.CREATE_SPRINT, ACTIONS.ADD_COMMENT]) {
      expect(can("MEMBER", a)).toBe(false);
    }
  });
  it("cannot delete anything", () => {
    for (const a of [ACTIONS.DELETE_ISSUE, ACTIONS.DELETE_PROJECT, ACTIONS.DELETE_ATTACHMENT]) {
      expect(can("MEMBER", a)).toBe(false);
    }
  });
});

describe("VIEWER — read-only", () => {
  it.each(ALL_ACTIONS)("cannot %s", (action) => expect(can("VIEWER", action)).toBe(false));
});

describe("edge cases", () => {
  it("unknown action is denied", () => expect(can("ADMIN", "fly_to_the_moon")).toBe(false));
  it("null / missing role is denied", () => {
    expect(can(null, ACTIONS.CREATE_ISSUE)).toBe(false);
    expect(can(undefined, ACTIONS.CREATE_ISSUE)).toBe(false);
  });
  it("unknown role is denied", () => expect(can("GUEST", ACTIONS.CREATE_ISSUE)).toBe(false));
  it("canAny is true if any action is allowed", () => {
    expect(canAny("MEMBER", [ACTIONS.CREATE_ISSUE, ACTIONS.CHANGE_ISSUE_STATUS])).toBe(true);
    expect(canAny("MEMBER", [ACTIONS.CREATE_ISSUE, ACTIONS.DELETE_ISSUE])).toBe(false);
  });
  it("getPermissions lists every action", () => {
    expect(Object.keys(getPermissions("MANAGER")).sort()).toEqual([...ALL_ACTIONS].sort());
  });
});
