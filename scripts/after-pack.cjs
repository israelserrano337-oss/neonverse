// Tras empaquetar: incrusta el icono real y la información de versión en NEONVERSE AI.exe
// (sin Wine, con resedit; funciona al construir desde Windows o Linux).
const fs = require('node:fs');
const path = require('node:path');
exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const ResEdit = require('resedit');
  const exe = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.exe`);
  const ico = path.join(ctx.packager.projectDir, 'build', 'icon.ico');
  const data = fs.readFileSync(exe);
  const exeObj = ResEdit.NtExecutable.from(data, { ignoreCert: true });
  const rsrc = ResEdit.NtExecutableResource.from(exeObj);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(ico));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(rsrc.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(rsrc.entries, groupId, lang, iconFile.icons.map((i) => i.data));
  const vi = ResEdit.Resource.VersionInfo.fromEntries(rsrc.entries)[0] || ResEdit.Resource.VersionInfo.createEmpty();
  const v = ctx.packager.appInfo.version.split('.').map(Number);
  vi.setFileVersion(v[0], v[1], v[2], 0); vi.setProductVersion(v[0], v[1], v[2], 0);
  vi.setStringValues({ lang: 1034, codepage: 1200 }, { ProductName: 'NEONVERSE AI 2.0', FileDescription: 'NEONVERSE AI 2.0 — Futuristic Music Video Studio', CompanyName: 'NEONVERSE', LegalCopyright: 'NEONVERSE AI 2.0', OriginalFilename: 'NEONVERSE AI.exe', InternalName: 'neonverse' });
  vi.outputToResourceEntries(rsrc.entries);
  rsrc.outputResource(exeObj);
  fs.writeFileSync(exe, Buffer.from(exeObj.generate()));
  console.log('  • icono y versión incrustados en', path.basename(exe));
};
