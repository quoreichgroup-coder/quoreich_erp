FROM gotenberg/gotenberg:9.9.3-chromium@sha256:22bfa8b9abf2597aa4665df6d910040007146083eec240159256c8ba1d0cc341

USER root
COPY fonts/ /usr/local/share/fonts/qerp/
RUN fc-cache -f
USER gotenberg
