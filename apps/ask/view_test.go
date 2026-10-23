package main

import (
	"strings"
	"testing"

	"github.com/egoist/mygo/ui"
)

// testState builds the window state for one request and records emitted decisions
// instead of printing them and exiting.
func testState(t *testing.T, raw string) (*state, *[]string) {
	t.Helper()
	emitted := []string{}
	st := newState(mustParse(t, raw), func(j string) { emitted = append(emitted, j) })
	return st, &emitted
}

func tester(st *state) *ui.Tester {
	return ui.NewTester(st.view, 640, 600)
}

func TestViewShowsHeaderKeysAndGrantedRows(t *testing.T) {
	st, _ := testState(t, requestJSON)
	tt := tester(st)
	tt.Frame()

	for _, want := range []string{
		"dogsout — 凭据请求",
		"新请求的 key",
		"claude-code@laptop",
		"sess_9f2ac31e",
		"gh",
		"github.com PAT · repo read",
		"dogsout://dev/openai/key", // openai's note is empty: the address is shown instead
		"已授权（只读）",
		"hf",
		"剩 47m",
		"长期 · 30d 衰减",
		"全部拒绝",
		"批准 3 个",
	} {
		if !tt.HasText(want) {
			t.Errorf("missing text %q; texts=%q", want, tt.Texts())
		}
	}
	if st.Tier() != "10m" {
		t.Errorf("default tier = %q, want 10m", st.Tier())
	}
}

func TestViewGrantedSectionIsAbsentWhenNoGrants(t *testing.T) {
	const raw = `{"principal":"p@l","session":"s1","at":"2026-10-09T21:14:00Z","keys":[{"alias":"gh","address":"dogsout://dev/gh/pat"}]}`
	st, _ := testState(t, raw)
	tt := tester(st)
	tt.Frame()
	if tt.HasText("已授权（只读）") {
		t.Errorf("granted section must stay hidden when empty; texts=%q", tt.Texts())
	}
	if !tt.HasText("批准 1 个") {
		t.Errorf("missing count label; texts=%q", tt.Texts())
	}
}

func TestViewPerKeyChoices(t *testing.T) {
	st, _ := testState(t, requestJSON)
	tt := tester(st)

	if err := tt.Click("openai 本次"); err != nil {
		t.Fatal(err)
	}
	if st.Choices["openai"] != choiceOnce {
		t.Fatalf("openai = %q, want once", st.Choices["openai"])
	}
	if err := tt.Click("aws 拒绝"); err != nil {
		t.Fatal(err)
	}
	if st.Choices["aws"] != choiceDeny {
		t.Fatalf("aws = %q, want deny", st.Choices["aws"])
	}
	if st.Choices["gh"] != choiceTTL {
		t.Fatalf("gh = %q, want the untouched default ttl", st.Choices["gh"])
	}
	if st.ApprovedCount() != 2 {
		t.Fatalf("approved count = %d, want 2", st.ApprovedCount())
	}
	if !tt.HasText("批准 2 个") {
		t.Errorf("count label did not follow the choices; texts=%q", tt.Texts())
	}
	if err := tt.Click("aws 批准"); err != nil {
		t.Fatal(err)
	}
	if st.Choices["aws"] != choiceTTL || st.ApprovedCount() != 3 {
		t.Fatalf("aws back to approve: choice=%q count=%d", st.Choices["aws"], st.ApprovedCount())
	}
}

func TestViewTTLTiers(t *testing.T) {
	st, _ := testState(t, requestJSON)
	tt := tester(st)
	for _, tier := range TTLTiers {
		if err := tt.Click("TTL " + tier); err != nil {
			t.Fatalf("tier %s: %v", tier, err)
		}
		if st.Tier() != tier {
			t.Fatalf("tier = %q after clicking %q", st.Tier(), tier)
		}
	}
	if st.Tier() != "always" || st.TTLIndex != 5 {
		t.Fatalf("last tier = %q (index %d)", st.Tier(), st.TTLIndex)
	}
}

func TestViewApproveButtonEmitsDecision(t *testing.T) {
	st, emitted := testState(t, requestJSON)
	tt := tester(st)
	if err := tt.Click("openai 本次"); err != nil {
		t.Fatal(err)
	}
	if err := tt.Click("aws 拒绝"); err != nil {
		t.Fatal(err)
	}
	if err := tt.Click("批准 2 个"); err != nil {
		t.Fatal(err)
	}
	if len(*emitted) != 1 || (*emitted)[0] != referenceDecision {
		t.Fatalf("emitted = %v, want the reference decision", *emitted)
	}
}

func TestViewEnterShortcutApproves(t *testing.T) {
	st, emitted := testState(t, requestJSON)
	tt := tester(st)
	if err := tt.Click("openai 本次"); err != nil {
		t.Fatal(err)
	}
	if err := tt.Click("aws 拒绝"); err != nil {
		t.Fatal(err)
	}
	tt.Key(0, ui.KeyEnter)
	if len(*emitted) == 0 {
		t.Fatal("Enter emitted nothing")
	}
	if (*emitted)[0] != referenceDecision {
		t.Fatalf("Enter emitted %s, want the reference decision", (*emitted)[0])
	}
}

func TestViewDenyAllEmitsBareDeny(t *testing.T) {
	st, emitted := testState(t, requestJSON)
	tt := tester(st)
	if err := tt.Click("全部拒绝"); err != nil {
		t.Fatal(err)
	}
	if len(*emitted) != 1 || (*emitted)[0] != `{"decision":"deny"}` {
		t.Fatalf("emitted = %v, want the bare deny", *emitted)
	}
}

func TestHeaderTime(t *testing.T) {
	if got := headerTime("not a time"); got != "not a time" {
		t.Errorf("unparseable stamp should pass through, got %q", got)
	}
	if got := headerTime("2026-10-09T21:14:00Z"); strings.TrimSpace(got) == "" || strings.Contains(got, "T") {
		t.Errorf("parsed stamp should be a local wall clock, got %q", got)
	}
}
