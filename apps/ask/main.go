package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

// dogsout-approve — the native approval window, in Go (mygo native UI, no cgo).
//
// Contract (packages/type-contracts/src/ask.ts): dogsout writes AskRequest JSON to a file,
// launches the helper with --request, and reads the Decision JSON from stdout. Closing
// the window without a decision is fail-closed: the bare deny. --selftest prints a
// deterministic reference decision and touches no window (used by build.sh and tests).

func main() {
	mode, path, err := parseArgs(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, "dogsout-approve: "+err.Error())
		os.Exit(2)
	}
	if mode == modeSelftest {
		fmt.Println(selftestDecision)
		return
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "dogsout-approve: cannot read request "+path+": "+err.Error())
		os.Exit(2)
	}
	req, err := ParseRequest(raw)
	if err != nil {
		fmt.Fprintln(os.Stderr, "dogsout-approve: "+err.Error())
		os.Exit(2)
	}

	st := newState(req, emitDecision)
	mygo.App.SetName("dogsout-approve")
	mygo.App.WhenReady(func() {
		mygo.NewWindow(mygo.WindowOptions{
			Title:     "dogsout-approve",
			Width:     560,
			Height:    520,
			MinWidth:  480,
			MinHeight: 420,
			Content:   ui.View(st.view),
		})
		mygo.App.Focus()
	})
	if err := mygo.App.Run(); err != nil {
		fmt.Fprintln(os.Stderr, "dogsout-approve: "+err.Error())
		os.Exit(1)
	}
	// The window closed, or the app quit, with no decision: fail closed.
	st.Deny()
}

// emitDecision is the only exit of the window: one decision line on stdout, then out.
func emitDecision(decision string) {
	fmt.Println(decision)
	os.Exit(0)
}

type argMode int

const (
	modeRequest argMode = iota
	modeSelftest
)

// parseArgs is the headless half of the CLI: --selftest wins, --request needs a path.
func parseArgs(args []string) (argMode, string, error) {
	for _, a := range args {
		if a == "--selftest" {
			return modeSelftest, "", nil
		}
	}
	for i, a := range args {
		if a != "--request" {
			continue
		}
		if i+1 >= len(args) || strings.HasPrefix(args[i+1], "-") {
			return modeRequest, "", fmt.Errorf("--request needs a path")
		}
		return modeRequest, args[i+1], nil
	}
	return modeRequest, "", fmt.Errorf("usage: dogsout-approve --request <path> | --selftest")
}
