import ssl

import certifi
from django.core.mail.backends.smtp import EmailBackend as SmtpEmailBackend
from django.utils.functional import cached_property


class CertifiSMTPEmailBackend(SmtpEmailBackend):
    """SMTP backend that verifies TLS against certifi's CA bundle.

    Fixes CERTIFICATE_VERIFY_FAILED on Windows, where Python often can't see
    the system certificate chain, without turning certificate checks off.
    """

    @cached_property
    def ssl_context(self):
        return ssl.create_default_context(cafile=certifi.where())
