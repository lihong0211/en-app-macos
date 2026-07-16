from utils.security import hash_password, verify_password, generate_token


def test_hash_password_produces_different_string():
    hashed = hash_password("mypassword")
    assert hashed != "mypassword"
    assert len(hashed) > 20


def test_verify_password_correct():
    hashed = hash_password("mypassword")
    assert verify_password("mypassword", hashed) is True


def test_verify_password_wrong():
    hashed = hash_password("mypassword")
    assert verify_password("wrongpassword", hashed) is False


def test_generate_token_is_random_and_long():
    t1 = generate_token()
    t2 = generate_token()
    assert t1 != t2
    assert len(t1) >= 32
