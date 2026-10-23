package main

import (
	"testing"
)

// The contract reference literal: what the native helper's --selftest prints, what
// apps/web/src/approval/parity.test.tsx pins, and what this helper must emit for the
// same three choices (gh=approve, openai=once, aws=deny, tier 10m).
const referenceDecision = `{"decision":"approve","ttl":"10m","renew_existing":false,"keys":{"aws":"deny","gh":"ttl","openai":"once"}}`

const requestJSON = `{
	"principal": "claude-code@laptop",
	"session": "sess_9f2ac31e",
	"at": "2026-10-09T21:14:00Z",
	"keys": [
		{"alias": "gh", "address": "dogsout://dev/gh/pat", "note": "github.com PAT · repo read", "value_hash": "aa11"},
		{"alias": "openai", "address": "dogsout://dev/openai/key", "note": "", "value_hash": "bb22"},
		{"alias": "aws", "address": "dogsout://staging/aws/secret", "note": "sts staging · env", "value_hash": "cc33"}
	],
	"granted": [
		{"alias": "hf", "status": "剩 47m"},
		{"alias": "gemini", "status": "长期 · 30d 衰减"}
	]
}`

func mustParse(t *testing.T, raw string) *AskRequest {
	t.Helper()
	req, err := ParseRequest([]byte(raw))
	if err != nil {
		t.Fatalf("ParseRequest: %v", err)
	}
	return req
}

func TestParseRequestAcceptsWireShape(t *testing.T) {
	req := mustParse(t, requestJSON)
	if req.Principal != "claude-code@laptop" || req.Session != "sess_9f2ac31e" {
		t.Fatalf("header: %+v", req)
	}
	if len(req.Keys) != 3 || req.Keys[0].ValueHash != "aa11" || req.Keys[0].Note != "github.com PAT · repo read" {
		t.Fatalf("keys: %+v", req.Keys)
	}
	if len(req.Granted) != 2 || req.Granted[1].Status != "长期 · 30d 衰减" {
		t.Fatalf("granted: %+v", req.Granted)
	}
}

func TestParseRequestAcceptsMissingGranted(t *testing.T) {
	raw := `{"principal":"p","session":"s","at":"2026-10-09T21:14:00Z","keys":[{"alias":"gh","address":"dogsout://dev/gh/pat"}]}`
	req := mustParse(t, raw)
	if len(req.Granted) != 0 {
		t.Fatalf("granted should default to empty: %+v", req.Granted)
	}
	if req.Keys[0].Note != "" || req.Keys[0].ValueHash != "" {
		t.Fatalf("optional key fields should default to empty: %+v", req.Keys[0])
	}
}

func TestParseRequestRejects(t *testing.T) {
	cases := []struct{ name, raw string }{
		{"not json", `not json`},
		{"empty object", `{}`},
		{"no principal", `{"session":"s","at":"t","keys":[{"alias":"gh","address":"a"}]}`},
		{"no session", `{"principal":"p","at":"t","keys":[{"alias":"gh","address":"a"}]}`},
		{"no at", `{"principal":"p","session":"s","keys":[{"alias":"gh","address":"a"}]}`},
		{"no keys", `{"principal":"p","session":"s","at":"t","keys":[]}`},
		{"empty alias", `{"principal":"p","session":"s","at":"t","keys":[{"alias":"","address":"a"}]}`},
		{"empty address", `{"principal":"p","session":"s","at":"t","keys":[{"alias":"gh","address":""}]}`},
		{"duplicate alias", `{"principal":"p","session":"s","at":"t","keys":[{"alias":"gh","address":"a"},{"alias":"gh","address":"b"}]}`},
	}
	for _, c := range cases {
		if _, err := ParseRequest([]byte(c.raw)); err == nil {
			t.Errorf("%s: expected an error", c.name)
		}
	}
}

func TestNewStateDefaults(t *testing.T) {
	st := newState(mustParse(t, requestJSON), func(string) {})
	if st.Tier() != "10m" {
		t.Fatalf("default tier = %q, want 10m", st.Tier())
	}
	if st.ApprovedCount() != 3 {
		t.Fatalf("default choices must all be approve, count = %d", st.ApprovedCount())
	}
	for _, k := range st.Req.Keys {
		if st.Choices[k.Alias] != choiceTTL {
			t.Fatalf("%s default = %q, want ttl", k.Alias, st.Choices[k.Alias])
		}
	}
	if TTLTiers[st.TTLIndex] != "10m" || TTLTiers[0] != "once" || TTLTiers[5] != "always" {
		t.Fatalf("tier list drifted from TTL_UI_TIERS: %v", TTLTiers)
	}
}

func TestDecisionJSONMatchesReference(t *testing.T) {
	st := newState(mustParse(t, requestJSON), func(string) {})
	st.SetChoice("openai", choiceOnce)
	st.SetChoice("aws", choiceDeny)
	if got := st.DecisionJSON(); got != referenceDecision {
		t.Fatalf("decision\n got: %s\nwant: %s", got, referenceDecision)
	}
}

func TestDecisionJSONDenyAllIsBare(t *testing.T) {
	st := newState(mustParse(t, requestJSON), func(string) {})
	for _, k := range st.Req.Keys {
		st.SetChoice(k.Alias, choiceDeny)
	}
	if st.ApprovedCount() != 0 {
		t.Fatalf("approved count = %d, want 0", st.ApprovedCount())
	}
	if got := st.DecisionJSON(); got != `{"decision":"deny"}` {
		t.Fatalf("all-denied decision = %s, want the bare deny literal", got)
	}
}

// Picking the once tier turns every approve into a one-shot key (mockup + web
// model.ts#decisionFor); the request never records a grant for those.
func TestDecisionJSONOnceTierMapsApproveToOnce(t *testing.T) {
	st := newState(mustParse(t, requestJSON), func(string) {})
	st.TTLIndex = 0
	st.SetChoice("aws", choiceDeny)
	want := `{"decision":"approve","ttl":"once","renew_existing":false,"keys":{"aws":"deny","gh":"once","openai":"once"}}`
	if got := st.DecisionJSON(); got != want {
		t.Fatalf("once-tier decision\n got: %s\nwant: %s", got, want)
	}
}

func TestEmitPaths(t *testing.T) {
	var got []string
	st := newState(mustParse(t, requestJSON), func(j string) { got = append(got, j) })
	st.SetChoice("gh", choiceOnce)
	st.SetChoice("openai", choiceDeny)
	st.SetChoice("aws", choiceDeny)
	st.Approve()
	st.Deny()
	if len(got) != 2 {
		t.Fatalf("emits = %v", got)
	}
	if got[0] != `{"decision":"approve","ttl":"10m","renew_existing":false,"keys":{"aws":"deny","gh":"once","openai":"deny"}}` {
		t.Fatalf("approve emit = %s", got[0])
	}
	if got[1] != `{"decision":"deny"}` {
		t.Fatalf("deny emit = %s", got[1])
	}
}
