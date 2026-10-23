package main

import (
	"testing"
)

func TestParseArgs(t *testing.T) {
	cases := []struct {
		name    string
		args    []string
		mode    argMode
		path    string
		wantErr bool
	}{
		{"selftest", []string{"--selftest"}, modeSelftest, "", false},
		{"selftest wins", []string{"--request", "/tmp/ask.json", "--selftest"}, modeSelftest, "", false},
		{"request", []string{"--request", "/tmp/ask.json"}, modeRequest, "/tmp/ask.json", false},
		{"request without path", []string{"--request"}, modeRequest, "", true},
		{"request with a flag-shaped path", []string{"--request", "-x"}, modeRequest, "", true},
		{"no args", nil, modeRequest, "", true},
		{"unknown flag", []string{"--nope"}, modeRequest, "", true},
	}
	for _, c := range cases {
		mode, path, err := parseArgs(c.args)
		if c.wantErr {
			if err == nil {
				t.Errorf("%s: expected an error", c.name)
			}
			continue
		}
		if err != nil {
			t.Errorf("%s: %v", c.name, err)
			continue
		}
		if mode != c.mode || path != c.path {
			t.Errorf("%s: got (%v, %q), want (%v, %q)", c.name, mode, path, c.mode, c.path)
		}
	}
}

func TestSelftestLiteralIsTheContractReference(t *testing.T) {
	// Keep this byte-identical to apps/web/src/approval/parity.test.tsx REFERENCE and
	// packages/type-contracts/src/ask.test.ts: the three copies are the wire contract.
	const want = `{"decision":"approve","ttl":"10m","renew_existing":false,"keys":{"aws":"deny","gh":"ttl","openai":"once"}}`
	if selftestDecision != want {
		t.Fatalf("selftest literal drifted:\n got: %s\nwant: %s", selftestDecision, want)
	}
}
