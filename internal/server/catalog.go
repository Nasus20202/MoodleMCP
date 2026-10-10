package server

import (
	"context"
	"sync"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/nasus/moodle-mcp/internal/moodle"
	"github.com/nasus/moodle-mcp/internal/tools"
)

// catalog lists the tools exactly as MCP clients see them. It is computed once, lazily.
type catalog struct {
	once  sync.Once
	tools []ToolInfo
	err   error
}

func (c *catalog) get(ctx context.Context) ([]ToolInfo, error) {
	c.once.Do(func() { c.tools, c.err = listTools(ctx) })
	return c.tools, c.err
}

// listTools asks a real MCP server over an in-memory transport, so the UI cannot drift
// from what tools/list returns.
func listTools(ctx context.Context) ([]ToolInfo, error) {
	srv := tools.New(moodle.New("http://unused.invalid", "", moodle.Options{}), nil)
	clientTransport, serverTransport := mcp.NewInMemoryTransports()

	serverSession, err := srv.Connect(ctx, serverTransport, nil)
	if err != nil {
		return nil, err
	}
	defer serverSession.Close()

	client := mcp.NewClient(&mcp.Implementation{Name: "catalog"}, nil)
	session, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		return nil, err
	}
	defer session.Close()

	res, err := session.ListTools(ctx, nil)
	if err != nil {
		return nil, err
	}
	infos := make([]ToolInfo, 0, len(res.Tools))
	for _, t := range res.Tools {
		infos = append(infos, toToolInfo(t))
	}
	return infos, nil
}

func toToolInfo(t *mcp.Tool) ToolInfo {
	return ToolInfo{
		Name:        t.Name,
		Description: t.Description,
		ReadOnly:    t.Annotations != nil && t.Annotations.ReadOnlyHint,
		InputSchema: t.InputSchema,
	}
}
