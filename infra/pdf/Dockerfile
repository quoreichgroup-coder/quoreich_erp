FROM gotenberg/gotenberg:9.2.0-chromium@sha256:1b37aa0a4407b204ee810c64a4daf8c36c9a7c12115f2680c363530c3dd27d6c

USER root
COPY fonts/ /usr/local/share/fonts/qerp/
RUN fc-cache -f
USER gotenberg
