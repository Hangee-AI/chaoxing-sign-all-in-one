"""mitmproxy addon：只挑出普通群签到页的 URL，把 activeId + chatId 落到临时文件。

用法见同目录的 chaoxing-grab-sign.bat。
"""
import os
import re

OUT = os.path.join(os.environ.get("TEMP", "/tmp"), "cx-sign-url.txt")


def request(flow):
    url = flow.request.pretty_url
    if "mobilelearn.chaoxing.com/sign/preSign" not in url:
        return
    if not re.search(r"activeId=\d+", url) or not re.search(r"chatId=\d+", url):
        return
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(url)
