#!/usr/bin/env python3
"""Generate the .eml fixture corpus.

Deterministic: re-running produces byte-identical files, so a fixture change
always shows up as a reviewable diff. Run from the repository root:

    python3 docs/fixtures/eml/generate.py
"""
import base64
import hashlib
import pathlib
import zlib

OUT = pathlib.Path(__file__).parent

def write(name, text):
    # .eml files use CRLF line endings; normalise so the generator is
    # editable with ordinary LF source above.
    data = text.replace("\r\n", "\n").replace("\n", "\r\n").encode("utf-8")
    (OUT / name).write_bytes(data)
    print(f"{name}: {len(data)} bytes")

def tiny_png_b64():
    """A 1x1 red PNG, built rather than pasted so it is auditable."""
    def chunk(tag, payload):
        body = tag + payload
        return (len(payload).to_bytes(4, "big") + body +
                zlib.crc32(body).to_bytes(4, "big"))
    ihdr = (1).to_bytes(4, "big") + (1).to_bytes(4, "big") + bytes([8, 2, 0, 0, 0])
    raw = bytes([0, 255, 0, 0])
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) +
           chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
    return base64.b64encode(png).decode("ascii")

# 1 -------------------------------------------------------------- plain text
write("01-plain-text.eml", """\
Return-Path: <jsmith@acme-manufacturing.example>
Received: from mail.acme-manufacturing.example (mail.acme-manufacturing.example
 [203.0.113.24]) by mx.firm.example with ESMTPS id 4a1f9c2e
 for <counsel@firm.example>; Tue, 4 Mar 2026 09:14:31 -0800 (PST)
Authentication-Results: mx.firm.example; dkim=pass header.d=acme-manufacturing.example
Message-ID: <20260304171422.A1F9C@acme-manufacturing.example>
Date: Tue, 4 Mar 2026 09:14:22 -0800
From: John Smith <jsmith@acme-manufacturing.example>
To: Robert Jones <counsel@firm.example>
Subject: Delivery schedule
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8

Bob,

Confirming the dates we discussed on the call:

  - First shipment: March 18
  - Balance: April 2

> On Mar 3, 2026, Robert Jones wrote:
> Can you send the revised schedule before Friday?
>> Earlier still, someone else wrote:
>> Is the schedule final?

Regards,
John
""")

# 2 --------------------------------------------- html with nested quoting
write("02-html-nested-quotes.eml", """\
Message-ID: <20260305181200.B2C3D@firm.example>
Date: Wed, 5 Mar 2026 10:12:00 -0800
From: Robert Jones <counsel@firm.example>
To: John Smith <jsmith@acme-manufacturing.example>
Cc: Paralegal Desk <docket@firm.example>
Subject: RE: Delivery schedule
MIME-Version: 1.0
Content-Type: text/html; charset=utf-8

<html><body>
<p>John,</p>
<p>Understood &mdash; please confirm <b>in writing</b> that the
<i>April 2</i> date is firm.</p>
<ul><li>Shipment one: March 18</li><li>Balance: April 2</li></ul>
<blockquote>
  <p>On Mar 4, John Smith wrote:</p>
  <p>Confirming the dates we discussed.</p>
  <blockquote>
    <p>On Mar 3, Robert Jones wrote:</p>
    <p>Can you send the revised schedule?</p>
    <blockquote><p>Is the schedule final?</p></blockquote>
  </blockquote>
</blockquote>
<p>Robert Jones<br>Jones & Associates<br>tel 555-0142</p>
</body></html>
""")

# 3 ------------------------------------------- multipart/related inline cid
write("03-inline-cid-image.eml", f"""\
Message-ID: <20260306090000.C3D4E@acme-manufacturing.example>
Date: Thu, 6 Mar 2026 09:00:00 -0800
From: John Smith <jsmith@acme-manufacturing.example>
To: Robert Jones <counsel@firm.example>
Subject: Signed page
MIME-Version: 1.0
Content-Type: multipart/related; boundary="rel-boundary"; type="text/html"

--rel-boundary
Content-Type: text/html; charset=utf-8

<html><body><p>See the mark-up below.</p>
<p><img src="cid:markup001" alt="marked up page" width="48" height="48"></p>
<p>John</p></body></html>

--rel-boundary
Content-Type: image/png
Content-ID: <markup001>
Content-Transfer-Encoding: base64
Content-Disposition: inline; filename="markup.png"

{tiny_png_b64()}

--rel-boundary--
""")

# 4 ------------------------------------------------- broken base64 payload
write("04-broken-base64.eml", """\
Message-ID: <20260307120000.D4E5F@acme-manufacturing.example>
Date: Fri, 7 Mar 2026 12:00:00 -0800
From: John Smith <jsmith@acme-manufacturing.example>
To: Robert Jones <counsel@firm.example>
Subject: Corrupted message
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: base64

VGhpcyBpcyB0aGUgcmVhZGFibGUgb3BlbmluZyBsaW5lLg==
!!!!not valid base64 at all!!!!
====
""")

# 5 ------------------------------------ RFC 2047 encoded-word, non-Latin
write("05-encoded-word-subject.eml", """\
Message-ID: <20260308080000.E5F6A@example.example>
Date: Sat, 8 Mar 2026 08:00:00 +0300
From: =?UTF-8?B?0JDQvdC90LAg0JjQstCw0L3QvtCy0LA=?= <anna@example.example>
To: Robert Jones <counsel@firm.example>
Subject: =?UTF-8?B?0J/QtdGA0LXQstC+0LQg0LTQvtCz0L7QstC+0YDQsA==?=
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8

Здравствуйте,

Перевод договора прилагается. 契約書の翻訳を添付します。

Анна
""")

# 6 ------------------------------------------- attached message/rfc822
write("06-forwarded-message.eml", """\
Message-ID: <20260309140000.F6A7B@firm.example>
Date: Sun, 9 Mar 2026 14:00:00 -0700
From: Robert Jones <counsel@firm.example>
To: Senior Partner <partner@firm.example>
Subject: Fwd: Delivery schedule
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="fwd-boundary"

--fwd-boundary
Content-Type: text/plain; charset=utf-8

Forwarding for your review. Note the date in the original.

--fwd-boundary
Content-Type: message/rfc822
Content-Disposition: attachment; filename="original.eml"

Message-ID: <20260304171422.A1F9C@acme-manufacturing.example>
Date: Tue, 4 Mar 2026 09:14:22 -0800
From: John Smith <jsmith@acme-manufacturing.example>
To: Robert Jones <counsel@firm.example>
Subject: Delivery schedule
Content-Type: text/plain; charset=utf-8

Bob,

Confirming the dates we discussed on the call.

John

--fwd-boundary--
""")

# 7 ------------------------------------------------ large PDF attachment
def make_pdf(size_bytes):
    """A structurally valid one-page PDF padded with a comment to `size_bytes`."""
    head = (b"%PDF-1.4\n"
            b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
            b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
            b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n")
    tail = (b"trailer<</Root 1 0 R/Size 4>>\n%%EOF\n")
    pad = b"% " + b"A" * max(0, size_bytes - len(head) - len(tail) - 3) + b"\n"
    return head + pad + tail

# Large binary fixtures are generated, never committed — see the .gitignore entry
# for docs/fixtures/eml/07-*.eml. A static-site repository should not carry an
# 8 MB base64 blob that a script reproduces byte-for-byte in under a second.
pdf_bytes = make_pdf(6 * 1024 * 1024)
pdf_b64 = base64.b64encode(pdf_bytes).decode("ascii")
pdf_b64_wrapped = "\n".join(pdf_b64[i:i + 76] for i in range(0, len(pdf_b64), 76))
write("07-large-pdf-attachment.eml", f"""\
Message-ID: <20260310100000.A7B8C@acme-manufacturing.example>
Date: Mon, 10 Mar 2026 10:00:00 -0700
From: John Smith <jsmith@acme-manufacturing.example>
To: Robert Jones <counsel@firm.example>
Subject: Executed agreement
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="pdf-boundary"

--pdf-boundary
Content-Type: text/plain; charset=utf-8

Executed copy attached.

--pdf-boundary
Content-Type: application/pdf; name="executed-agreement.pdf"
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="executed-agreement.pdf"

{pdf_b64_wrapped}

--pdf-boundary--
""")
print(f"  (attachment sha256 {hashlib.sha256(pdf_bytes).hexdigest()[:12]})")

# 8 --------------------------------------- outlook-style nested tables
write("08-outlook-tables.eml", """\
Message-ID: <20260311093000.B8C9D@acme-manufacturing.example>
Date: Tue, 11 Mar 2026 09:30:00 -0700
From: Accounts Payable <ap@acme-manufacturing.example>
To: Robert Jones <counsel@firm.example>
Subject: Invoice summary Q1
MIME-Version: 1.0
Content-Type: text/html; charset=utf-8

<html><head><style>.x { color: red; }</style></head><body>
<table border="1" cellpadding="4" style="border-collapse:collapse">
<tr><th>Invoice</th><th>Date</th><th>Amount</th><th>Status</th></tr>
<tr><td>INV-1041</td><td>2026-01-14</td><td>$12,400.00</td><td>Paid</td></tr>
<tr><td>INV-1055</td><td>2026-02-02</td><td>$8,115.50</td><td>Paid</td></tr>
<tr><td>INV-1092</td><td>2026-03-01</td><td>$41,980.25</td><td>
  <table><tr><td>Disputed</td></tr><tr><td>see counsel</td></tr></table>
</td></tr>
</table>
<p style="color:#888;font-size:11px">This message and any attachments are
confidential.</p>
</body></html>
""")

# 9 ----------------------------------- tracking pixel and remote images
write("09-remote-images.eml", """\
Message-ID: <20260312110000.C9DAE@marketing.example>
Date: Wed, 12 Mar 2026 11:00:00 -0700
From: Vendor Updates <news@marketing.example>
To: Robert Jones <counsel@firm.example>
Subject: Your March statement is ready
MIME-Version: 1.0
Content-Type: text/html; charset=utf-8

<html><body>
<img src="https://track.marketing.example/open?id=abc123" width="1" height="1">
<h1>March statement</h1>
<p><img src="https://cdn.marketing.example/banner.png" width="600" height="120"
   alt="March promotion banner"></p>
<p>Your statement is available. <a href="https://portal.marketing.example/s/9f2">
View statement</a>.</p>
<script>window.alert('should never run');</script>
</body></html>
""")

# 10 ------------------------------------------------- headers, no body
write("10-headers-only.eml", """\
Message-ID: <20260313070000.DAEBF@example.example>
Date: Thu, 13 Mar 2026 07:00:00 -0700
From: Automated Notice <noreply@example.example>
To: Robert Jones <counsel@firm.example>
Subject: Read receipt
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8

""")

print("done")
