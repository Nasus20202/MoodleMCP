package moodle

// QRLogin is the content of a Moodle app QR code: moodlemobile://<site>?qrlogin=KEY&userid=ID.
type QRLogin struct {
	Site   string
	Key    string
	UserID int
}

// ajaxCall is one entry of a request to Moodle's lib/ajax/service*.php endpoints.
type ajaxCall struct {
	Index      int            `json:"index"`
	MethodName string         `json:"methodname"`
	Args       map[string]any `json:"args"`
}

// ajaxResult is one entry of the response to an ajaxCall.
type ajaxResult[T any] struct {
	Error     bool           `json:"error"`
	Data      T              `json:"data"`
	Exception *ajaxException `json:"exception"`
}

type ajaxException struct {
	ErrorCode string `json:"errorcode"`
	Message   string `json:"message"`
}

// qrTokens is the data returned by tool_mobile_get_tokens_for_qr_login.
type qrTokens struct {
	Token string `json:"token"`
}

// wsException is the error body Moodle's REST endpoint returns (with HTTP 200) when a call fails.
type wsException struct {
	Exception string `json:"exception"`
	ErrorCode string `json:"errorcode"`
	Message   string `json:"message"`
}

// siteInfo is the subset of core_webservice_get_site_info we use.
type siteInfo struct {
	UserID int `json:"userid"`
}
