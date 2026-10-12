<script lang="ts">
  import type { ToolInfo } from '@moodle-mcp/shared';

  import { codeSegments, summary, toolArguments } from '../lib/tools';

  let { tool, open = $bindable(false) }: { tool: ToolInfo; open?: boolean } = $props();
  const args = $derived(toolArguments(tool));
</script>

<details class="tool-row" bind:open>
  <summary class="tool-summary">
    <span class="chevron" aria-hidden="true">▸</span>
    <h3 class="shrink-0 font-mono text-sm font-semibold">{tool.name}</h3>
    <span class="muted min-w-0 flex-1 truncate text-sm">{summary(tool.description)}</span>
    {#if tool.readOnly}<span class="badge hidden shrink-0 sm:inline">read-only</span>{/if}
  </summary>
  <div class="pb-3 pl-6">
    <p class="muted text-sm">
      {#each codeSegments(tool.description) as part, i (i)}{#if part.code}<code>{part.text}</code
          >{:else}{part.text}{/if}{/each}
    </p>
    {#if args.length > 0}
      <dl class="params">
        {#each args as arg (arg.name)}
          <dt>
            <code class="param-name">{arg.name}</code>
            <span class="param-type">{arg.type}</span>
            <span class="param-flag" class:param-required={arg.required}
              >{arg.required ? 'required' : 'optional'}</span
            >
          </dt>
          <dd>
            {#each codeSegments(arg.description ?? '') as part, i (i)}{#if part.code}<code>{part.text}</code
                >{:else}{part.text}{/if}{/each}
            {#if arg.default !== undefined}<span class="opacity-70">(default: {arg.default})</span>{/if}
          </dd>
        {/each}
      </dl>
    {/if}
  </div>
</details>
