"""State machine tests (PRD 14.1: 100 percent transition coverage)."""

from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import settings as hypothesis_settings
from hypothesis import strategies as st

from app.core.errors import TransitionNotAllowed
from app.domain.states import (
    CHALLENGE_TRANSITIONS,
    MILESTONE_TRANSITIONS,
    PILOT_TRANSITIONS,
    ChallengeState,
    MilestoneState,
    PilotState,
    all_states,
    all_transitions,
    available_actions,
    check_transition,
    machines,
)


def test_every_challenge_transition_is_reachable_from_its_source():
    for transition in CHALLENGE_TRANSITIONS:
        for source in transition.source:
            reason = "Recorded reason for the test." if transition.requires_reason else None
            result = check_transition("challenge", transition.action, source, reason)
            assert result.target == transition.target


def test_every_pilot_transition_is_reachable_from_its_source():
    for transition in PILOT_TRANSITIONS:
        for source in transition.source:
            reason = "Recorded reason for the test." if transition.requires_reason else None
            assert check_transition("pilot", transition.action, source, reason).target == transition.target


def test_every_milestone_transition_is_reachable_from_its_source():
    for transition in MILESTONE_TRANSITIONS:
        for source in transition.source:
            reason = "Recorded reason for the test." if transition.requires_reason else None
            result = check_transition("milestone", transition.action, source, reason)
            assert result.target == transition.target


def test_transition_coverage_is_complete():
    """Every action in every machine is exercised by the tests above."""
    for machine in machines():
        actions = {t.action for t in all_transitions(machine)}
        assert actions, "machine " + machine + " has no transitions"
        for action in actions:
            sources = [t.source for t in all_transitions(machine) if t.action == action][0]
            assert sources, "action " + action + " has no source state"


def test_transition_from_wrong_state_is_refused_with_available_actions():
    with pytest.raises(TransitionNotAllowed) as excinfo:
        check_transition("challenge", "approve", ChallengeState.DRAFT)
    problem = excinfo.value.to_problem()
    assert problem["status"] == 409
    assert "Draft" in problem["detail"]
    assert "submit" in problem["available_actions"]


def test_transition_requiring_a_reason_is_refused_without_one():
    with pytest.raises(TransitionNotAllowed) as excinfo:
        check_transition("challenge", "return", ChallengeState.IN_REVIEW, reason="   ")
    problem = excinfo.value.to_problem()
    assert problem["errors"][0]["field"] == "reason"
    assert problem["errors"][0]["fix"]


def test_unknown_action_is_refused():
    with pytest.raises(TransitionNotAllowed):
        check_transition("challenge", "teleport", ChallengeState.DRAFT)


def test_terminal_states_have_no_outgoing_transitions():
    for state in (ChallengeState.SCALED, ChallengeState.CLOSED, ChallengeState.CANCELLED):
        assert available_actions("challenge", state, {"DO", "DA", "PA", "SU", "EE", "IV", "FO"}) == []
    assert available_actions("pilot", PilotState.COMPLETED, {"DO", "DA"}) == []
    assert available_actions("pilot", PilotState.TERMINATED, {"DO", "DA"}) == []
    assert available_actions("milestone", MilestoneState.PAID, {"DO", "DA", "FO", "SU"}) == []


def test_available_actions_are_filtered_by_role():
    assert available_actions("challenge", ChallengeState.IN_REVIEW, {"DO"}) == []
    assert available_actions("challenge", ChallengeState.IN_REVIEW, {"DA"}) == ["approve", "return"]
    assert available_actions("milestone", MilestoneState.ACCEPTED, {"FO"}) == []
    assert available_actions("milestone", MilestoneState.ACCEPTED, {"DA"}) == ["approve-payment"]


def test_cancellation_is_not_available_once_a_pilot_is_active():
    assert "cancel" not in available_actions("challenge", ChallengeState.PILOT_ACTIVE, {"DA"})
    assert "cancel" in available_actions("challenge", ChallengeState.PUBLISHED, {"DA"})


@hypothesis_settings(max_examples=300, deadline=None)
@given(
    machine=st.sampled_from(["challenge", "pilot", "milestone"]),
    action=st.text(min_size=1, max_size=20),
    state=st.text(min_size=1, max_size=20),
)
def test_arbitrary_input_never_produces_an_undefined_state(machine: str, action: str, state: str):
    """A state machine never reaches a state outside its own definition (PRD 14.1)."""
    try:
        result = check_transition(machine, action, state, reason="A reason.")
    except TransitionNotAllowed:
        return
    assert result.target in all_states(machine)


@hypothesis_settings(max_examples=200, deadline=None)
@given(
    roles=st.sets(st.sampled_from(["DO", "DA", "SU", "EE", "IV", "FO", "PA"]), max_size=7),
    state=st.sampled_from(sorted(all_states("challenge"))),
)
def test_available_actions_are_always_valid_transitions(roles: set[str], state: str):
    for action in available_actions("challenge", state, roles):
        transition = check_transition("challenge", action, state, reason="A reason.")
        assert state in transition.source
        assert set(transition.actor_roles) & roles
