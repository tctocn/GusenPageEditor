"""Build a dependency-free local VSIX with the standard VS Code package layout."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as ET
import json
import mimetypes

plugin = Path(__file__).resolve().parent.parent
meta = json.loads((plugin / 'package.json').read_text())
output_dir = plugin / 'dist'
output_dir.mkdir(exist_ok=True)
output = output_dir / f"{meta['name']}-{meta['version']}.vsix"
namespace = 'http://schemas.microsoft.com/developer/vsx-schema/2011'
ET.register_namespace('', namespace)
def element(parent, name, attrs=None, text=None):
    node = ET.SubElement(parent, f'{{{namespace}}}{name}', attrs or {})
    if text is not None: node.text = text
    return node
manifest = ET.Element(f'{{{namespace}}}PackageManifest', {'Version': '2.0.0'})
metadata = element(manifest, 'Metadata')
element(metadata, 'Identity', {'Language': 'en-US', 'Id': meta['name'], 'Version': meta['version'], 'Publisher': meta['publisher']})
element(metadata, 'DisplayName', text=meta['displayName'])
element(metadata, 'Description', {'{http://www.w3.org/XML/1998/namespace}space': 'preserve'}, meta['description'])
element(metadata, 'Tags', text='gushen,json,offline')
element(metadata, 'Categories', text='Other')
element(metadata, 'GalleryFlags', text='')
props = element(metadata, 'Properties')
for key, value in {
    'Microsoft.VisualStudio.Code.Engine': meta['engines']['vscode'],
    'Microsoft.VisualStudio.Code.ExtensionKind': 'workspace',
    'Microsoft.VisualStudio.Code.ExecutesCode': 'true',
    'Microsoft.VisualStudio.Code.ExtensionDependencies': '',
    'Microsoft.VisualStudio.Code.ExtensionPack': '',
}.items(): element(props, 'Property', {'Id': key, 'Value': value})
install = element(manifest, 'Installation')
element(install, 'InstallationTarget', {'Id': 'Microsoft.VisualStudio.Code'})
element(manifest, 'Dependencies')
assets = element(manifest, 'Assets')
element(assets, 'Asset', {'Type': 'Microsoft.VisualStudio.Code.Manifest', 'Path': 'extension/package.json', 'Addressable': 'true'})
element(assets, 'Asset', {'Type': 'Microsoft.VisualStudio.Services.Content.Details', 'Path': 'extension/README.md', 'Addressable': 'true'})
types = ET.Element('Types', {'xmlns': 'http://schemas.openxmlformats.org/package/2006/content-types'})
for ext, mime in {'json':'application/json','js':'application/javascript','css':'text/css','html':'text/html','md':'text/markdown','vsixmanifest':'text/xml'}.items():
    ET.SubElement(types, 'Default', {'Extension': ext, 'ContentType': mime})
files = [plugin/'package.json', plugin/'README.md']
for directory in ['src', 'designer-assets', 'native-designer', 'platform-assets']:
    files.extend(sorted(p for p in (plugin/directory).rglob('*') if p.is_file() and not p.name.startswith('.')))
known = {item.attrib['Extension'] for item in types}
for file in files:
    ext = file.suffix.lstrip('.')
    if ext and ext not in known:
        ET.SubElement(types, 'Default', {'Extension': ext, 'ContentType': mimetypes.guess_type(file.name)[0] or 'application/octet-stream'})
        known.add(ext)
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    archive.writestr('extension.vsixmanifest', ET.tostring(manifest, encoding='utf-8', xml_declaration=True))
    archive.writestr('[Content_Types].xml', ET.tostring(types, encoding='utf-8', xml_declaration=True))
    for file in files: archive.write(file, 'extension/' + file.relative_to(plugin).as_posix())
with ZipFile(output) as archive:
    assert archive.testzip() is None
    ET.fromstring(archive.read('extension.vsixmanifest'))
    ET.fromstring(archive.read('[Content_Types].xml'))
    for file in files:
        assert archive.read('extension/' + file.relative_to(plugin).as_posix()) == file.read_bytes()
print(f'{output}\n已核对 {len(files)} 个交付文件，大小 {output.stat().st_size} 字节。')
