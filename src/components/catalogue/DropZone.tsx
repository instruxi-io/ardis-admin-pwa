/** File drop target for the publish batch. */

import { FileJson } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

export function DropZone({ count, onFiles }: {
  count: number
  onFiles: (dropped: { name: string; raw: string }[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  // Reads every dropped file before handing them over as one batch. Calling back
  // per file would append them in whatever order the reads happened to finish.
  const read = useCallback((list: FileList) => {
    const chosen = Array.from(list)
    if (chosen.length === 0) return
    Promise.all(chosen.map(f => new Promise<{ name: string; raw: string }>(resolve => {
      const reader = new FileReader()
      reader.onload = e => resolve({ name: f.name, raw: (e.target?.result as string) ?? '' })
      reader.onerror = () => resolve({ name: f.name, raw: '' })
      reader.readAsText(f)
    }))).then(read => onFiles(read.filter(r => r.raw)))
  }, [onFiles])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files) read(e.dataTransfer.files)
  }, [read])

  return (
    <div
      className={`border-2 border-dashed rounded-xl p-8 transition-all cursor-pointer text-center
        ${dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-muted/30'}`}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".json"
        multiple
        className="hidden"
        onChange={e => { if (e.target.files) read(e.target.files); e.target.value = '' }}
      />
      <div className="flex flex-col items-center gap-2">
        <div className="p-3 rounded-full bg-muted text-muted-foreground">
          <FileJson size={22} />
        </div>
        <p className="text-sm font-medium">
          {count === 0 ? 'Drop this product’s files here' : 'Drop another file'}
        </p>
        <p className="text-xs text-muted-foreground">
          Credential schema and product together, in any order &mdash; each says which it is
        </p>
        <p className="text-xs text-muted-foreground/60">or click to browse</p>
      </div>
    </div>
  )
}
