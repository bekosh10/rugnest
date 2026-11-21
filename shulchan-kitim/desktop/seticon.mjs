// put the app icon into the Windows exe (electron-builder skips this when signAndEditExecutable=false)
// node seticon.mjs <exe> <ico>
import fs from 'fs';
import * as ResEdit from 'resedit';
const [exe, ico] = process.argv.slice(2);
const data = fs.readFileSync(exe);
const exeObj = ResEdit.NtExecutable.from(data, { ignoreCert: true });
const r = ResEdit.NtExecutableResource.from(exeObj);
const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(ico));
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(r.entries, 1, 1033, iconFile.icons.map(i => i.data));
const vi = ResEdit.Resource.VersionInfo.fromEntries(r.entries)[0];
if (vi) {
  vi.setStringValues({ lang: 1033, codepage: 1200 }, { ProductName: 'Shulchan Kitim', FileDescription: 'Shulchan Kitim', CompanyName: 'Campus' });
  vi.outputToResourceEntries(r.entries);
}
r.outputResource(exeObj);
fs.writeFileSync(exe, Buffer.from(exeObj.generate()));
console.log('icon set');
