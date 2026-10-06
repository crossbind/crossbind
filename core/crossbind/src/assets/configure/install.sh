#!/bin/sh
# Docker Desktop's file sharing now and then refuses the chmod that install makes on a file it has just
# written (EPERM), at times on every attempt. The file is in place by then and a chmod by path is not
# refused, so a failure that is nothing but refused chmods ends with those.
mode=0755
prev=
for arg in "$@"; do
    case $prev in -m) mode=$arg ;; esac
    case $arg in --mode=*) mode=${arg#--mode=} ;; -m?*) mode=${arg#-m} ;; esac
    prev=$arg
done

{ errors=$(install "$@" 2>&1 1>&3); } 3>&1 && exit 0
status=$?
refused=$(printf '%s\n' "$errors" | sed -n \
    -e "s/^install: setting permissions for '\(.*\)': Operation not permitted$/\1/p" \
    -e "s/^install: setting permissions for ‘\(.*\)’: Operation not permitted$/\1/p")
if [ -n "$refused" ] && [ "$(printf '%s\n' "$refused" | wc -l)" -eq "$(printf '%s\n' "$errors" | wc -l)" ]; then
    printf '%s\n' "$refused" | while IFS= read -r file; do chmod "$mode" "$file" || exit 1; done && exit 0
fi
printf '%s\n' "$errors" >&2
exit $status
