// Command moodle-token obtains a Moodle mobile web service token for moodle-mcp.
//
//	moodle-token https://enauczanie.pg.edu.pl/2025   print a browser (SSO) login URL
//	moodle-token 'moodlemobile://token=BASE64'        decode the link Moodle redirected to
//	moodle-token 'moodlemobile://https://site?qrlogin=KEY&userid=1'   exchange a QR login key
//
// A QR key is single use and expires after a few minutes.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/nasus/moodle-mcp/internal/moodle"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: moodle-token <site URL | moodlemobile://token=… | decoded QR text>")
		os.Exit(2)
	}
	if err := run(strings.TrimSpace(os.Args[1])); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run(arg string) error {
	switch {
	case strings.Contains(arg, "://token="):
		tok, err := moodle.DecodeLaunchToken(arg)
		if err != nil {
			return err
		}
		printHeader(tok)
	case strings.Contains(arg, "qrlogin="):
		qr, err := moodle.ParseQRLogin(arg)
		if err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		tok, err := qr.Exchange(ctx, http.DefaultClient)
		if err != nil {
			return err
		}
		printHeader(tok)
	case strings.HasPrefix(arg, "http"):
		b := make([]byte, 8)
		rand.Read(b)
		fmt.Fprintln(os.Stderr, "Open this URL and sign in. On the page that follows, copy the address of the \"launch the app\" link\n(right-click -> Copy link address) and rerun with it:")
		fmt.Println(moodle.LaunchURL(arg, hex.EncodeToString(b)))
	default:
		return fmt.Errorf("unrecognised input")
	}
	return nil
}

func printHeader(tok string) {
	fmt.Fprintln(os.Stderr, "Add this header to your MCP connector:")
	fmt.Printf("Authorization: Bearer %s\n", tok)
}
