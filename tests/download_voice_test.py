import hashlib
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('download_voice', Path(__file__).resolve().parents[1] / 'scripts/download_voice.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
KEY = 'hu_HU-test-medium'
DATA = {KEY + '.onnx': b'onnx-model', KEY + '.onnx.json': b'{}', 'MODEL_CARD': b'CC0'}
CATALOG = {KEY: {'files': {'hu/hu_HU/test/medium/' + k: {'size_bytes': len(v), 'md5_digest': hashlib.md5(v).hexdigest()} for k, v in DATA.items()}}}
class Response(io.BytesIO):
    url = 'https://huggingface.co/test'
class DownloadTests(unittest.TestCase):
    def test_verified_install_and_cache(self):
        def fetch(url, timeout): return Response(DATA[url.rsplit('/', 1)[-1]])
        with tempfile.TemporaryDirectory() as directory, patch.object(mod.urllib.request, 'urlopen', side_effect=fetch) as mock:
            mod.download_voice(CATALOG, KEY, directory)
            mod.download_voice(CATALOG, KEY, directory)
            self.assertEqual(mock.call_count, 3)
            self.assertEqual((Path(directory) / (KEY + '.onnx')).read_bytes(), b'onnx-model')
    def test_bad_checksum_leaves_no_partial_model(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(mod.urllib.request, 'urlopen', return_value=Response(b'bad')):
            with self.assertRaises(ValueError): mod.download_voice(CATALOG, KEY, directory)
            self.assertFalse(list(Path(directory).iterdir()))
    def test_path_traversal_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError): mod.download_voice(CATALOG, '../escape', directory)
if __name__ == '__main__': unittest.main()
