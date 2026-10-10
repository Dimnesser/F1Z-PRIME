from app.services.masks import auto_mask, validate_mask


def test_auto_mask_keeps_beautiful_part():
    assert auto_mask("+14157777012", "+1") == "+1 *** 7777 ***"


def test_auto_mask_visible_override():
    m = auto_mask("+380670000000", "+380", visible="0000")
    assert m.startswith("+380 ") and "0000" in m and "*" in m


def test_validate_mask():
    assert validate_mask("+1 *** 7777 ***")
    assert not validate_mask("+1 555 7777 123")  # nothing hidden
    assert not validate_mask("<script>")
