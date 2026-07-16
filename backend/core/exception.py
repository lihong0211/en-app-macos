
from core import api_result


class JsonParseException(Exception):
    pass


class CntFormatException(Exception):
    pass


class BusinessException(Exception):
    code = 400
    msg = "服务器内部错误"

    def __init__(self, code=400, msg=""):
        super().__init__(msg)
        self.code = code
        self.msg = msg

    def json(self):
        return api_result.error(msg=self.msg, code=self.code)


class LoginInfoException(BusinessException):
    def __init__(self, msg="未登录或登录已过期"):
        super().__init__(code=401, msg=msg)
