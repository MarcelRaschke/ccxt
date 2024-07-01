import os
import sys

root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.append(root)

# ----------------------------------------------------------------------------

# PLEASE DO NOT EDIT THIS FILE, IT IS GENERATED AND WILL BE OVERWRITTEN:
# https://github.com/ccxt/ccxt/blob/master/CONTRIBUTING.md#how-to-contribute-code

# ----------------------------------------------------------------------------
# -*- coding: utf-8 -*-

from ccxt.test.base.test_number import test_number  # noqa E402
from ccxt.test.base.test_datetime import test_datetime  # noqa E402
from ccxt.test.base.test_cryptography import test_cryptography  # noqa E402
from ccxt.test.base.test_extend import test_extend  # noqa E402
from ccxt.test.base.test_language_specific import test_language_specific  # noqa E402
from ccxt.test.base.test_safe_methods import test_safe_methods  # noqa E402

def base_tests_init():
    test_language_specific()
    test_extend()
    test_cryptography()
    test_datetime()
    test_number()
    test_safe_methods()
