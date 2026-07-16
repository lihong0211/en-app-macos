from mitmproxy import http  # pyright: ignore[reportMissingImports]
from rich import print as rprint
import json
import subprocess
import os
import requests

TARGET_API = "https://fanyi.baidu.com/client/translate/word"

API_BASE_URL = "http://localhost:8000"


def save_word(translation_result):
    try:
        res = requests.post(
            f"{API_BASE_URL}/words/add",
            json=translation_result,
            headers={"Content-Type": "application/json"},
        )
        print(res.json())
        print(res.status_code)
        if res.status_code == 201:
            print(f"✅ 成功保存单词到数据库: {translation_result['word']}")
            return res.json()
        else:
            print(f"❌ 保存失败: {res.status_code} - {res.text}")
            return None

    except Exception as e:
        print(f"❌ 调用API失败: {e}")
        return None


def run_monitor():
    """
    启动 mitmdump 进程（在前台运行）
    """
    script_path = os.path.abspath(__file__)
    cmd = [
        "mitmdump",
        "--set",
        "upstream_cert=false",
        "--ssl-insecure",
        "-p",
        "6124",
        "-s",
        script_path,
    ]

    print(f"启动 mitmdump: {' '.join(cmd)}")
    try:
        # 在前台运行，不捕获输出
        return subprocess.Popen(cmd)
    except FileNotFoundError:
        print("⚠️ 找不到 mitmdump，跳过流量监控（不影响其他功能）")
        return None


def response(flow: http.HTTPFlow):
    """
    处理响应，构建结构化翻译结果对象
    """
    if flow.request.url.startswith(TARGET_API) and flow.response.content:
        try:
            # 解析主响应
            response_data = json.loads(flow.response.content.decode("utf-8"))
            result_str = response_data.get("data", {}).get("result")

            if result_str:
                # 解析result字段中的JSON
                result_data = json.loads(result_str)

                # 构建结构化对象
                translation_result = {
                    "word": result_data.get("src", ""),
                    "meaning": [],
                    "en_pronunciation": "",
                    "us_pronunciation": "",
                }

                # 提取释义信息
                for content_item in result_data.get("content", []):
                    for mean_item in content_item.get("mean", []):
                        meaning_type = mean_item.get("pre", "")
                        cont_dict = mean_item.get("cont", {})

                        if cont_dict:
                            # 将所有释义内容合并为一个字符串
                            meanings_list = list(cont_dict.keys())
                            meaning_content = ";".join(meanings_list)

                            translation_result["meaning"].append(
                                {"type": meaning_type, "content": meaning_content}
                            )

                # 提取发音信息
                for voice_item in result_data.get("voice", []):
                    if "en_phonic" in voice_item:
                        translation_result["en_pronunciation"] = voice_item["en_phonic"]
                    if "us_phonic" in voice_item:
                        translation_result["us_pronunciation"] = voice_item["us_phonic"]
                rprint(translation_result)
                data = save_word(translation_result)
                rprint("1111111", data)
                return translation_result
            return None

        except json.JSONDecodeError as e:
            print(f"[错误] JSON解析失败: {e}")
            return None
        except Exception as e:
            print(f"[错误] 处理响应时出错: {e}")
            return None
    return None
