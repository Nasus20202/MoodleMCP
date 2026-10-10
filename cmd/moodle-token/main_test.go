package main

import "testing"

func TestRunRejectsUnknownInput(t *testing.T) {
	if err := run("hello"); err == nil {
		t.Error("want error")
	}
	if err := run("moodlemobile://token=!!!"); err == nil {
		t.Error("want error for bad token link")
	}
}
