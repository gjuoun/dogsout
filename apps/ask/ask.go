package main

import (
	"encoding/json"
	"fmt"
	"strings"
)

// The wire half of the approval protocol lives in packages/type-contracts/src/ask.ts.
// These structs are that shape in Go: the helper reads an AskRequest and writes a
// Decision, nothing else. Unknown fields are ignored; anything that would make a
// decision ambiguous (no keys, an empty alias, a duplicate alias) is refused instead,
// so the channel fails and the chain degrades (fail-closed).

type AskedKey struct {
	Alias     string `json:"alias"`
	Address   string `json:"address"`
	Note      string `json:"note"`
	ValueHash string `json:"value_hash"`
}

type GrantedRow struct {
	Alias  string `json:"alias"`
	Status string `json:"status"`
}

type AskRequest struct {
	Principal string       `json:"principal"`
	Session   string       `json:"session"`
	At        string       `json:"at"`
	Keys      []AskedKey   `json:"keys"`
	Granted   []GrantedRow `json:"granted"`
}

// TTLTiers is TTL_UI_TIERS from the contract: the six tiers the window offers.
// "session" is a manifest tier and is never offered here.
var TTLTiers = [6]string{"once", "10m", "1h", "24h", "30d", "always"}

// TTLLabels are the window labels for TTLTiers (mockup wording: once = 本次,
// always = 长期).
var TTLLabels = [6]string{"本次", "10m", "1h", "24h", "30d", "长期"}

// DefaultTTLIndex is the 10m default (2026-10-09 ruling, DEFAULT_TTL in the contract).
const DefaultTTLIndex = 1

// choice is the per-key three-state from KeyChoiceSchema.
type choice string

const (
	choiceTTL   choice = "ttl"
	choiceOnce  choice = "once"
	choiceDeny  choice = "deny"
)

// selftestDecision is the contract reference literal (the same bytes as
// apps/web/src/approval/parity.test.tsx and packages/type-contracts ask.test.ts).
const selftestDecision = `{"decision":"approve","ttl":"10m","renew_existing":false,"keys":{"aws":"deny","gh":"ttl","openai":"once"}}`

type approveDecision struct {
	Decision      string            `json:"decision"`
	TTL           string            `json:"ttl"`
	RenewExisting bool              `json:"renew_existing"`
	Keys          map[string]choice `json:"keys"`
}

// denyDecision is its own struct: a deny carries no ttl, no renew_existing and no keys.
type denyDecision struct {
	Decision string `json:"decision"`
}

// ParseRequest validates an AskRequest read from --request.
func ParseRequest(raw []byte) (*AskRequest, error) {
	var req AskRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		return nil, fmt.Errorf("request is not JSON: %w", err)
	}
	if err := req.validate(); err != nil {
		return nil, err
	}
	return &req, nil
}

func (r *AskRequest) validate() error {
	if strings.TrimSpace(r.Principal) == "" {
		return fmt.Errorf("request.principal is empty")
	}
	if strings.TrimSpace(r.Session) == "" {
		return fmt.Errorf("request.session is empty")
	}
	if strings.TrimSpace(r.At) == "" {
		return fmt.Errorf("request.at is empty")
	}
	if len(r.Keys) == 0 {
		return fmt.Errorf("request.keys is empty")
	}
	seen := make(map[string]bool, len(r.Keys))
	for i, k := range r.Keys {
		if strings.TrimSpace(k.Alias) == "" {
			return fmt.Errorf("request.keys[%d].alias is empty", i)
		}
		if strings.TrimSpace(k.Address) == "" {
			return fmt.Errorf("request.keys[%d].address is empty", i)
		}
		if seen[k.Alias] {
			return fmt.Errorf("request.keys[%d].alias %q is duplicated", i, k.Alias)
		}
		seen[k.Alias] = true
	}
	for i, g := range r.Granted {
		if strings.TrimSpace(g.Alias) == "" {
			return fmt.Errorf("request.granted[%d].alias is empty", i)
		}
		if strings.TrimSpace(g.Status) == "" {
			return fmt.Errorf("request.granted[%d].status is empty", i)
		}
	}
	return nil
}

// state is the window's model: the request, the per-key choices, the selected tier,
// and the one way out (emit). Emitting is injected so tests never call os.Exit.
type state struct {
	Req      *AskRequest
	Choices  map[string]choice
	TTLIndex int
	emit     func(string)
}

func newState(req *AskRequest, emit func(string)) *state {
	st := &state{Req: req, Choices: make(map[string]choice, len(req.Keys)), TTLIndex: DefaultTTLIndex, emit: emit}
	for _, k := range req.Keys {
		st.Choices[k.Alias] = choiceTTL
	}
	return st
}

func (s *state) SetChoice(alias string, c choice) {
	s.Choices[alias] = c
}

func (s *state) Tier() string {
	return TTLTiers[s.TTLIndex]
}

// ApprovedCount is the "批准 N 个" count: every key not set to deny.
func (s *state) ApprovedCount() int {
	n := 0
	for _, k := range s.Req.Keys {
		if s.Choices[k.Alias] != choiceDeny {
			n++
		}
	}
	return n
}

// DecisionJSON is the approve decision, or the bare deny when every key is denied.
// Semantics match apps/web/src/approval/model.ts#decisionFor: approving under the
// once tier is a one-shot key (no grant), and a deny never carries a key map.
func (s *state) DecisionJSON() string {
	if s.ApprovedCount() == 0 {
		return denyJSON()
	}
	once := s.Tier() == "once"
	keys := make(map[string]choice, len(s.Req.Keys))
	for _, k := range s.Req.Keys {
		switch s.Choices[k.Alias] {
		case choiceDeny:
			keys[k.Alias] = choiceDeny
		case choiceOnce:
			keys[k.Alias] = choiceOnce
		default:
			if once {
				keys[k.Alias] = choiceOnce
			} else {
				keys[k.Alias] = choiceTTL
			}
		}
	}
	return encode(approveDecision{Decision: "approve", TTL: s.Tier(), RenewExisting: false, Keys: keys})
}

func denyJSON() string {
	return encode(denyDecision{Decision: "deny"})
}

// encode marshals a decision; the shapes above cannot fail to marshal, and the
// fallback is the bare deny literal rather than another encode (fail-closed, no loop).
func encode(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return `{"decision":"deny"}`
	}
	return string(b)
}

// Approve and Deny are the two exits; the injected emit prints and exits in main.
func (s *state) Approve() {
	s.emit(s.DecisionJSON())
}

func (s *state) Deny() {
	s.emit(denyJSON())
}
