package apps

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vul-os/vulos-apps/appsplatform"
	"github.com/vul-os/vulos-apps/mcp"
)

// TestMCPInitializeAndToolsList mounts the shared MCP server over the Office
// adapter and drives the initialize → tools/list handshake over HTTP with a
// vat_ app token, asserting the adapter's Act actions surface as MCP tools.
func TestMCPInitializeAndToolsList(t *testing.T) {
	adapter := newAdapter(t)

	// Ensure the adapter publishes its surface via the optional Descriptor seam.
	if _, ok := any(adapter).(mcp.Descriptor); !ok {
		t.Fatalf("OfficeAdapter does not implement mcp.Descriptor")
	}

	reg := appsplatform.NewMemoryRegistry()
	created, err := reg.Create(appsplatform.CreateParams{
		Name:     "agent",
		OwnerID:  "alice",
		Products: []string{appsplatform.ProductOffice},
		Scopes:   []string{appsplatform.ScopeAppsRead, appsplatform.ScopeAppsWrite},
	})
	if err != nil {
		t.Fatalf("registry create: %v", err)
	}

	h, err := mcp.NewHandler(mcp.MCPConfig{Adapter: adapter, Registry: reg})
	if err != nil {
		t.Fatalf("mcp.NewHandler: %v", err)
	}

	call := func(method string, params any) mcp.Response {
		t.Helper()
		body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
		req := httptest.NewRequest("POST", "/mcp", strings.NewReader(string(body)))
		req.Header.Set("Authorization", "Bearer "+created.Token)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		var resp mcp.Response
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode %s response (%q): %v", method, w.Body.String(), err)
		}
		return resp
	}

	// initialize
	init := call("initialize", map[string]any{"protocolVersion": mcp.ProtocolVersion})
	if init.Error != nil {
		t.Fatalf("initialize error: %+v", init.Error)
	}

	// tools/list must include every Act action the adapter exposes.
	tools := call("tools/list", nil)
	if tools.Error != nil {
		t.Fatalf("tools/list error: %+v", tools.Error)
	}
	listed, _ := json.Marshal(tools.Result)
	for _, want := range []string{"document.create", "document.append", "tool.run"} {
		if !strings.Contains(string(listed), want) {
			t.Fatalf("tools/list missing %q: %s", want, listed)
		}
	}

	// resources/list must include the Read kinds.
	resources := call("resources/list", nil)
	if resources.Error != nil {
		t.Fatalf("resources/list error: %+v", resources.Error)
	}
	gotRes, _ := json.Marshal(resources.Result)
	for _, want := range []string{"documents", "document"} {
		if !strings.Contains(string(gotRes), want) {
			t.Fatalf("resources/list missing %q: %s", want, gotRes)
		}
	}
}
