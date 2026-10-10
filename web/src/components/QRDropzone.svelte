<script lang="ts">
  import { decodeQR } from '../lib/qr';

  interface Props {
    /** Called with the QR text once an image has been decoded. May throw to report an error. */
    onText: (text: string) => Promise<void>;
    onError: (message: string) => void;
    active: boolean;
  }
  let { onText, onError, active }: Props = $props();

  let busy = $state(false);
  let dragging = $state(false);
  let preview = $state('');

  async function handleImage(file: File | undefined) {
    if (!file?.type.startsWith('image/')) return onError('Please provide an image file.');
    if (preview) URL.revokeObjectURL(preview);
    preview = URL.createObjectURL(file);

    busy = true;
    try {
      const text = await decodeQR(file);
      if (!text) throw new Error('No QR code found. Crop the screenshot closer to the code and try again.');
      await onText(text);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      busy = false;
    }
  }

  function onPaste(e: ClipboardEvent) {
    const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
    if (file && active) {
      e.preventDefault();
      handleImage(file);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    handleImage(e.dataTransfer?.files[0]);
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    dragging = true;
  }

  function onPick(e: Event & { currentTarget: HTMLInputElement }) {
    handleImage(e.currentTarget.files?.[0]);
  }
</script>

<svelte:window onpaste={onPaste} />

<label class="dropzone" class:dropzone-active={dragging} ondragover={onDragOver} ondragleave={() => (dragging = false)} ondrop={onDrop}>
  {#if preview}
    <img src={preview} alt="Your screenshot" class="max-h-40 rounded-lg shadow" />
  {:else}
    <span class="text-3xl" aria-hidden="true">📷</span>
  {/if}
  <span class="muted text-sm">{busy ? 'Reading QR code…' : 'Drop a screenshot here, or click to choose'}</span>
  <input type="file" accept="image/*" class="sr-only" onchange={onPick} />
</label>
