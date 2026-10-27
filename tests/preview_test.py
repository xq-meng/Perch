import io
from email.message import Message
from unittest import TestCase
from unittest.mock import Mock, patch
from urllib.request import Request

from scripts.preview import PublicRedirects, fetch_resource, local_request, public_url


class Response(io.BytesIO):
    def __init__(self, content, mime):
        super().__init__(content)
        self.headers = Message()
        self.headers["Content-Type"] = mime

    def geturl(self):
        return "https://www.youtube.com/"


class PreviewTests(TestCase):
    def test_homepage_omits_private_path_and_query(self):
        self.assertEqual(public_url("https://www.youtube.com/private?token=secret#part", homepage=True), "https://www.youtube.com/")
        self.assertEqual(public_url("https://cdn.example.com/icon.png?v=1#part"), "https://cdn.example.com/icon.png?v=1")

    def test_private_destinations_and_credentials_are_rejected(self):
        for url in ("file:///tmp/test", "javascript:alert(1)", "https://user:password@example.com/", "http://127.0.0.1/", "http://10.0.0.1/", "http://172.16.1.1/", "http://192.168.1.1/", "http://169.254.1.1/", "http://device.local/", "http://localhost/"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                public_url(url)

    def test_helper_is_only_available_to_local_same_origin_requests(self):
        self.assertTrue(local_request({"Host": "127.0.0.1:5173", "Sec-Fetch-Site": "same-origin"}, 5173))
        self.assertTrue(local_request({"Host": "localhost:5173", "Origin": "http://localhost:5173"}, 5173))
        self.assertFalse(local_request({"Host": "evil.example:5173"}, 5173))
        self.assertFalse(local_request({"Host": "127.0.0.1:5173", "Origin": "https://evil.example"}, 5173))
        self.assertFalse(local_request({"Host": "127.0.0.1:5173", "Sec-Fetch-Site": "cross-site"}, 5173))

    def test_metadata_stops_at_head_without_forwarding_cookies(self):
        head = b'<head><link rel="icon" sizes="96x96" href="/icon.png"></head>'
        response = Response(head + b"x" * 600000, "text/html; charset=utf-8")
        opener = Mock()
        opener.open.return_value = response
        with patch("scripts.preview.build_opener", return_value=opener):
            page = fetch_resource("https://www.youtube.com/private?token=secret", "html")
        self.assertEqual(page["html"], head.decode())
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, "https://www.youtube.com/")
        self.assertFalse(request.has_header("Cookie"))
        self.assertFalse(request.has_header("Authorization"))
        self.assertFalse(request.has_header("Referer"))

    def test_non_image_and_oversized_responses_are_rejected(self):
        for content, mime in ((b"<html>", "text/html"), (b"x" * (256 * 1024 + 1), "image/png")):
            opener = Mock()
            opener.open.return_value = Response(content, mime)
            with patch("scripts.preview.build_opener", return_value=opener), self.assertRaises(ValueError):
                fetch_resource("https://www.youtube.com/favicon.ico", "image")

    def test_redirects_cannot_target_local_services(self):
        handler = PublicRedirects()
        request = Request("https://www.youtube.com/")
        with self.assertRaises(ValueError):
            handler.redirect_request(request, None, 302, "Found", {}, "http://127.0.0.1/admin")
