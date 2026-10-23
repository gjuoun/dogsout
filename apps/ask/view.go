package main

import (
	"fmt"
	"time"

	"github.com/egoist/mygo/ui"
)

// The window: the same three regions as the validated mockup — the decision area
// (one row per asked key, three states, six TTL tiers), the read-only granted
// section, and the two exits. Labels are per-alias, so a screen reader (and the
// headless tester) can address one row's button among identical visible words.

type choiceOption struct {
	choice choice
	label  string
}

var choiceOptions = [3]choiceOption{
	{choiceTTL, "批准"},
	{choiceOnce, "本次"},
	{choiceDeny, "拒绝"},
}

// keyNote is the second line of a key row: the request's note, or its address.
func keyNote(k AskedKey) string {
	if k.Note != "" {
		return k.Note
	}
	return k.Address
}

// headerTime renders the request's wall-clock stamp in local time; an unparseable
// value is shown as it came.
func headerTime(at string) string {
	t, err := time.Parse(time.RFC3339, at)
	if err != nil {
		return at
	}
	return t.Local().Format("2006-01-02 15:04")
}

func (s *state) view(c *ui.Context) {
	t := c.Theme()
	ui.Column(c).Fill().Gap(14).Padding(20).Children(func() {
		// Return approves, like the SwiftUI helper's default button. A deferred command in
		// the window's scope beats a focused button (a plain Shortcut() query does not).
		c.OnShortcut(0, ui.KeyEnter, func() { s.Approve() })

		ui.Column(c).Gap(2).Children(func() {
			ui.Text(c, "dogsout — 凭据请求").FontSize(16).Bold()
			ui.Text(c, s.Req.Principal+" · "+s.Req.Session+" · "+headerTime(s.Req.At)).
				FontSize(12).TextColor(t.TextMuted)
		})

		ui.Column(c).Gap(8).Children(func() {
			ui.Text(c, "新请求的 key").FontSize(13).Bold().TextColor(t.TextMuted)
			for i := range s.Req.Keys {
				k := s.Req.Keys[i]
				ui.Row(c).Gap(10).AlignItems(ui.Center).Children(func() {
					ui.Column(c).Gap(1).Children(func() {
						ui.Text(c, k.Alias).FontSize(14).Bold()
						ui.Text(c, keyNote(k)).FontSize(11).TextColor(t.TextMuted)
					})
					ui.Spacer(c)
					for _, opt := range choiceOptions {
						label := k.Alias + " " + opt.label
						var btn ui.Element
						if s.Choices[k.Alias] == opt.choice {
							btn = ui.PrimaryButton(c, opt.label)
						} else {
							btn = ui.Button(c, opt.label)
						}
						if btn.Label(label).Width(64).Clicked() {
							s.SetChoice(k.Alias, opt.choice)
						}
					}
				})
			}
		})

		ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
			ui.Text(c, "TTL").FontSize(13).Bold().TextColor(t.TextMuted)
			for i, tier := range TTLTiers {
				idx := i
				var btn ui.Element
				if s.TTLIndex == i {
					btn = ui.PrimaryButton(c, TTLLabels[i])
				} else {
					btn = ui.Button(c, TTLLabels[i])
				}
				if btn.Label("TTL " + tier).Clicked() {
					s.TTLIndex = idx
				}
			}
		})

		if len(s.Req.Granted) > 0 {
			ui.Column(c).Gap(4).Children(func() {
				ui.Text(c, "已授权（只读）").FontSize(13).Bold().TextColor(t.TextMuted)
				for _, g := range s.Req.Granted {
					ui.Row(c).Gap(10).Children(func() {
						ui.Text(c, g.Alias).FontSize(13)
						ui.Spacer(c)
						ui.Text(c, g.Status).FontSize(13).TextColor(t.TextMuted)
					})
				}
			})
		}

		ui.Spacer(c)

		ui.Row(c).Gap(10).Children(func() {
			if ui.Button(c, "全部拒绝").Label("全部拒绝").Clicked() {
				s.Deny()
			}
			approve := ui.PrimaryButton(c, fmt.Sprintf("批准 %d 个", s.ApprovedCount()))
			if approve.Clicked() {
				s.Approve()
			}
		})
	})
}
