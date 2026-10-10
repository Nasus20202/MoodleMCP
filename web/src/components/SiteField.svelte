<script lang="ts">
  import { session } from '../lib/session.svelte';
</script>

<label class="mb-4 block">
  <span class="eyebrow mb-1 block">Moodle site</span>
  <input class="input" type="url" spellcheck="false" placeholder="https://moodle.example.edu" bind:value={session.site} />
</label>
