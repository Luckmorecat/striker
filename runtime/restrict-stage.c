#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/landlock.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

#ifndef LANDLOCK_ACCESS_FS_TRUNCATE
#define LANDLOCK_ACCESS_FS_TRUNCATE (1ULL << 14)
#endif

static void fail(const char *operation) {
  perror(operation);
  exit(125);
}

static void allow_path(int ruleset, const char *path, uint64_t access) {
  int fd = open(path, O_PATH | O_CLOEXEC);
  if (fd < 0) fail(path);
  struct stat statbuf;
  if (fstat(fd, &statbuf)) fail("fstat");
  if (!S_ISDIR(statbuf.st_mode)) {
    access &= LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE |
              LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_TRUNCATE;
  }
  struct landlock_path_beneath_attr rule = {
    .allowed_access = access, .parent_fd = fd
  };
  if (syscall(SYS_landlock_add_rule, ruleset, LANDLOCK_RULE_PATH_BENEATH,
              &rule, 0)) fail("landlock_add_rule");
  close(fd);
}

int main(int argc, char **argv) {
  if (argc < 5 || strcmp(argv[3], "--")) {
    fprintf(stderr, "usage: restrict-stage READ_ROOT WRITE_ROOT -- COMMAND...\n");
    return 125;
  }
  if (syscall(SYS_landlock_create_ruleset, NULL, 0,
              LANDLOCK_CREATE_RULESET_VERSION) < 3) fail("Landlock ABI >= 3 required");
  char canonical[PATH_MAX];
  if (!realpath(argv[2], canonical) || strcmp(canonical, argv[2])) {
    fprintf(stderr, "Scratch path must be canonical and contain no symlinks\n");
    return 125;
  }
  uint64_t read_access = LANDLOCK_ACCESS_FS_EXECUTE |
    LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR;
  uint64_t all_access = (LANDLOCK_ACCESS_FS_TRUNCATE << 1) - 1;
  struct landlock_ruleset_attr attr = { .handled_access_fs = all_access };
  int ruleset = syscall(SYS_landlock_create_ruleset, &attr, sizeof(attr), 0);
  if (ruleset < 0) fail("landlock_create_ruleset");
  const char *system_paths[] = { "/usr", "/bin", "/lib", "/lib64", "/etc", "/opt", "/proc" };
  for (size_t i = 0; i < sizeof(system_paths) / sizeof(system_paths[0]); i++) {
    if (access(system_paths[i], F_OK) == 0) allow_path(ruleset, system_paths[i], read_access);
  }
  allow_path(ruleset, argv[1], read_access);
  allow_path(ruleset, argv[2], all_access);
  allow_path(ruleset, "/dev/null", all_access);
  allow_path(ruleset, "/dev/urandom", read_access);
  allow_path(ruleset, "/dev/random", read_access);
  allow_path(ruleset, "/dev/zero", read_access);
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) fail("no_new_privs");
  if (syscall(SYS_landlock_restrict_self, ruleset, 0)) fail("landlock_restrict_self");
  close(ruleset);
  if (chdir(argv[1])) fail("chdir");
  execvp(argv[4], &argv[4]);
  fail("execvp");
}
