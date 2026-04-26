# oh-my-opencode-slim `/auto-continue` Notes

Tanggal catat: 2026-04-26
Repo referensi: `alvinunreal/oh-my-opencode-slim`

## Tujuan catatan

Menyimpan pola kerja `/auto-continue` dari `oh-my-opencode-slim` supaya tidak perlu riset ulang saat menyamakan perilaku `/autopilot` di repo ini.

## File referensi yang dipelajari

- `src/index.ts`
- `docs/todo-continuation.md`
- `docs/quick-reference.md`

## Cara kerja `/auto-continue`

Pola implementasinya bukan command API khusus dari OpenCode. Polanya adalah kombinasi tiga hal:

1. command didaftarkan di config agar dikenali host,
2. tool diekspos untuk perilaku dasarnya,
3. `command.execute.before` dipakai untuk intercept command itu.

## Detail mekanisme

### 1. Registrasi command di `config()`

Di `src/index.ts`, plugin memastikan `opencodeConfig.command['auto-continue']` ada.

Bentuknya kurang lebih seperti ini:

```ts
opencodeConfig.command['auto-continue'] = {
  template: 'Call the auto_continue tool with enabled=true',
  description: 'Enable auto-continuation ...',
}
```

Fungsi langkah ini:

- membuat `/auto-continue` muncul sebagai command yang dikenali OpenCode,
- memberi template fallback kalau host menjalankan command lewat template path biasa.

## 2. Tool diekspos sebagai primitive utama

Plugin juga mengekspor tool namespace yang memuat `auto_continue`.

Artinya perilaku fitur sebenarnya berada di tool/internal hook, bukan di markdown command file terpisah dan bukan di command template itu sendiri.

Kesimpulan penting:

- command adalah pintu masuk UX,
- tool adalah primitive eksekusi fitur.

## 3. `command.execute.before` jadi jalur intercept utama

Di `src/index.ts`, plugin mendefinisikan:

```ts
'command.execute.before': async (input, output) => {
  await todoContinuationHook.handleCommandExecuteBefore(input, output)
}
```

Komentar inline di repo referensi menyatakan niat yang sangat jelas:

- command didaftarkan supaya dikenali OpenCode,
- handling sebenarnya dilakukan oleh `command.execute.before`,
- targetnya adalah bypass LLM round-trip,
- output diinjeksikan langsung ke `output.parts`.

Ini pola referensi utama yang harus diingat.

## Kontrak user-facing `/auto-continue`

Berdasarkan `docs/todo-continuation.md`:

- tool `auto_continue` menerima toggle via `{ enabled: true | false }`,
- slash command `/auto-continue` menerima `on`, `off`, atau toggle tanpa argumen.

Jadi command itu shortcut UX di atas fitur internal yang sama.

## Ringkasan arsitektur

Versi singkat alurnya:

```text
user mengetik /auto-continue
-> host mengenali command karena ada di config.command
-> plugin hook command.execute.before menerima input command
-> hook internal memutuskan output
-> output.parts diisi langsung
-> fitur aktif/nonaktif tanpa bergantung pada respons LLM biasa
```

## Implikasi untuk repo `autopilot-plugin`

Pola dari `oh-my-opencode-slim` yang harus ditiru adalah:

1. daftarkan `command.autopilot` di `config()`,
2. expose tool `autopilot` sebagai primitive fitur,
3. intercept `/autopilot` di `command.execute.before`,
4. isi `output.parts` langsung dari hook internal.

## Kesimpulan penting

`oh-my-opencode-slim` tidak membuktikan adanya API native khusus untuk plugin-defined slash command.

Yang dibuktikan repo itu justru ini:

- command discovery memakai `config.command`,
- perilaku fitur ditopang tool internal,
- command interception diharapkan terjadi lewat `command.execute.before`.

Kalau pola itu sudah sama tetapi runtime lokal masih memperlakukan command sebagai prompt biasa, maka masalahnya kemungkinan ada di perilaku runtime OpenCode yang terpasang, bukan di perbedaan arsitektur plugin.

## Hal yang perlu dicek lagi kalau lupa

- apakah `command.autopilot.template` sudah terpasang di resolved config,
- apakah tool `autopilot` benar-benar diexpose oleh plugin,
- apakah `command.execute.before` untuk `autopilot` membersihkan dan mengisi `output.parts`,
- apakah runtime OpenCode versi aktif benar-benar mengeksekusi hook ini untuk custom command.
